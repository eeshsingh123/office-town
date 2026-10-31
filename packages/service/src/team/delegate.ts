import type {
  AgentRecord,
  Attachment,
  DepartmentRecord,
  SessionRecord,
} from "@office-town/contract";
import { environmentPath } from "@office-town/harness";
import { z } from "zod";
import { instructionsFor } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { readOnlyFoldersOfTask } from "../chief/piece-folders.ts";
import type { SessionActivity } from "../registry/activity.ts";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { FolderNotFoundError } from "../task-folders.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { nextWork, workerBrief } from "./briefs.ts";
import { busyAgents, groupName, isOpen, latestSession, leadsTeam } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { workerFolders } from "./worktrees.ts";

const SHOWN_BRIEF = 80;
const SHOWN_FAILURE = 300;

const shortened = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

export interface LedTeam {
  name: string;
  // None for a group task.
  department: DepartmentRecord | undefined;
  lead: AgentRecord;
  goal: string;
  workers: AgentRecord[];
}

export function teamOf({ store }: TeamContext, caller: Caller): LedTeam | undefined {
  const task = store.getTask(caller.taskId);
  const lead = store.getAgent(caller.agentId);
  if (task?.leadAgentId !== caller.agentId || lead === undefined) return undefined;
  if (task.workerAgentIds !== undefined) {
    const workers = task.workerAgentIds.flatMap((id) => store.getAgent(id) ?? []);
    return { name: groupName(lead), department: undefined, lead, goal: task.prompt, workers };
  }
  if (task.departmentId === undefined) return undefined;
  const department = store.getDepartment(task.departmentId);
  if (department === undefined) return undefined;
  const workers = store.listMembers(department.id).filter((member) => member.id !== lead.id);
  return { name: department.name, department, lead, goal: task.prompt, workers };
}

// A harness reads its tools once, at start, so a lead has them from its first session.
export const isLead =
  ({ store }: TeamContext) =>
  (caller: Caller) =>
    leadsTeam(store, caller);

export const NOT_YET = "Your team is not approved yet. Wait for the user to answer your proposal.";

// Continues the worker's session in this task if it has one. Workers run at the same time.
export async function startWork(
  context: TeamContext,
  team: LedTeam,
  caller: Caller,
  worker: AgentRecord,
  work: string,
  attachments: Attachment[],
): Promise<SessionRecord> {
  const { store, registry } = context;
  const lead = { id: team.lead.id, name: team.lead.name };
  const given = attachments.length === 0 ? {} : { attachments };
  const next = { ...nextWork(lead, work), ...given };
  const earlier = latestSession(context, caller.taskId, worker.id);
  if (earlier !== undefined && isOpen(earlier)) {
    try {
      await registry.tell(earlier.id, next);
      return earlier;
    } catch (error) {
      // It was being stopped for being idle: it is resumed instead.
      if (!(error instanceof SessionNotRunningError)) throw error;
    }
  }
  if (earlier?.harnessSessionId !== undefined) {
    try {
      return await registry.resume(earlier.id, next);
    } catch (error) {
      // A folder removed since, such as a merged worktree: the worker starts afresh.
      if (!(error instanceof FolderNotFoundError)) throw error;
    }
  }
  const { branch, ...folders } = await workerFolders(
    context,
    team.department,
    worker,
    caller.taskId,
  );
  return registry.start({
    taskId: caller.taskId,
    agentId: worker.id,
    options: sessionOptionsFor(store, worker, {
      ...folders,
      readOnlyPaths: [
        ...new Set([...folders.readOnlyPaths, ...readOnlyFoldersOfTask(store, caller.taskId)]),
      ],
    }),
    message: {
      ...workerBrief({
        goal: team.goal,
        teamName: team.name,
        role: worker.role ?? "worker",
        lead,
        folders,
        branch,
        instructions: instructionsFor(store, worker),
        work,
      }),
      ...given,
    },
  });
}

// The lead names files from its own list, by path as it sees them or by name.
function filesToPass(context: TeamContext, caller: Caller, wanted: string[]): Attachment[] {
  const { store } = context;
  const environment = store.getSession(caller.sessionId)?.options.environment;
  const known = store.taskAttachments(caller.taskId);
  return wanted.map((name) => {
    const found = known.find(
      (attachment) =>
        attachment.name === name ||
        attachment.path === name ||
        (environment !== undefined && environmentPath(environment, attachment.path) === name),
    );
    if (found === undefined) {
      const names = known.map((attachment) => attachment.name).join(", ") || "none";
      throw new ToolError(`"${name}" is not one of the files you were given. Yours: ${names}.`);
    }
    return found;
  });
}

// Only to the lead's own workers; workers cannot hire.
export function delegate(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "delegate",
    description:
      "Hand one of your workers a piece of work. The brief must stand alone: the worker knows " +
      "the team's goal but nothing of your conversation. It returns at once; the worker's " +
      "result reaches you later as a message. Workers run at the same time. To pass on files " +
      "the user gave you, list them in files; the worker gets them read-only.",
    input: z.object({
      agent: z.string().min(1).describe("The worker's name, such as @ben-1042."),
      brief: z.string().min(1).describe("What to do, what to hand back, and any constraints."),
      files: z
        .array(z.string().min(1))
        .optional()
        .describe("Files from your list to pass on, each by its exact path or name."),
    }),
    offeredTo: isLead(context),
    async call({ agent, brief, files = [] }, caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const attachments = filesToPass(context, caller, files);
      const worker = team.workers.find((member) => member.name === agent);
      if (worker === undefined) {
        const names = team.workers.map((member) => member.name).join(", ") || "none yet";
        throw new ToolError(`${agent} is not on your team. Your workers: ${names}.`);
      }
      const earlier = latestSession(context, caller.taskId, worker.id);
      const here = earlier !== undefined && isOpen(earlier);
      if (!here && busyAgents(store, [worker.id]).length > 0) {
        throw new ToolError(`${worker.name} is busy on another task. Try again once it is free.`);
      }
      if (earlier !== undefined && store.workingDelegation(earlier.id) !== undefined) {
        throw new ToolError(
          `${worker.name} is still working on its last piece. Its result will reach you as a message.`,
        );
      }
      const session = await startWork(context, team, caller, worker, brief, attachments);
      if (!isOpen(session)) {
        throw new ToolError(`${worker.name} could not start. Its trace says why.`);
      }
      store.createDelegation({
        taskId: caller.taskId,
        workerAgentId: worker.id,
        workerSessionId: session.id,
        brief,
      });
      return `Delegated to ${worker.name} (${worker.role ?? "worker"}). Its result will reach you as a message when it finishes.`;
    },
  });
}

function stateOf(
  context: TeamContext,
  activity: SessionActivity,
  caller: Caller,
  worker: AgentRecord,
  waiting: Set<string>,
): string {
  const session = latestSession(context, caller.taskId, worker.id);
  if (session === undefined) return "has no work yet";
  const working = context.store.workingDelegation(session.id);
  if (waiting.has(session.id)) return "is waiting for the user";
  if (working !== undefined) {
    const minutes = Math.round((Date.now() - Date.parse(working.createdAt)) / 60_000);
    const piece = shortened(working.brief, SHOWN_BRIEF);
    const active = activity.of(session.id)?.lastActive;
    const quiet = active === undefined ? 0 : Math.round((Date.now() - active) / 60_000);
    const last = quiet === 0 ? "" : `, last active ${quiet} min ago`;
    return `is working on "${piece}" (for ${minutes} min${last})`;
  }
  if (isOpen(session) && activity.of(session.id)?.turnOpen) return "is at work";
  const last = context.store
    .listDelegations(caller.taskId)
    .findLast((one) => one.workerAgentId === worker.id);
  if (last?.status === "failed") {
    return `failed on its last piece: ${shortened(last.result ?? "no reason given", SHOWN_FAILURE)}`;
  }
  if (!isOpen(session) && last?.status === "stopped") return "was stopped before it finished";
  return session.status === "failed" ? "failed on its last piece" : "has finished its last piece";
}

export function teamStatus(context: TeamContext, activity: SessionActivity) {
  const { store } = context;
  return defineTool({
    name: "team_status",
    description:
      "List your workers, what each is doing now, and the work still out with them. Results " +
      "reach you by themselves, so do not call this over and over to wait for one.",
    input: z.object({}),
    offeredTo: isLead(context),
    call(_, caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const waiting = new Set(
        store.listPendingRequests().requests.map(({ event }) => event.sessionId),
      );
      const lines = team.workers.map((worker) => {
        const { harness, model } = worker.settings;
        const runs = `${harness}${model ? `, ${model}` : ""}`;
        return `- ${worker.name}, ${worker.role ?? "worker"} (${runs}): ${stateOf(context, activity, caller, worker, waiting)}`;
      });
      const open = store.listDelegations(caller.taskId).filter((one) => one.status === "working");
      return `${team.name}:\n${lines.join("\n") || "No workers yet."}\n\nWork still out: ${open.length}.`;
    },
  });
}
