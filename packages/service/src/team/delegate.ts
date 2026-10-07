import type { AgentRecord, DepartmentRecord, SessionRecord } from "@office-town/contract";
import { z } from "zod";
import { settingsOf } from "../agents/agents.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { readOnlyFoldersOfTask } from "../chief/piece-folders.ts";
import type { SessionActivity } from "../registry/activity.ts";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { FolderNotFoundError } from "../task-folders.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { nextWork, workerBrief } from "./briefs.ts";
import { isOpen, latestSession, leadsTeam } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { workerFolders } from "./worktrees.ts";

const SHOWN_BRIEF = 80;

interface LedTeam {
  department: DepartmentRecord;
  lead: AgentRecord;
  goal: string;
  workers: AgentRecord[];
}

function teamOf({ store }: TeamContext, caller: Caller): LedTeam | undefined {
  const task = store.getTask(caller.taskId);
  if (task?.leadAgentId !== caller.agentId || task.departmentId === undefined) return undefined;
  const department = store.getDepartment(task.departmentId);
  const lead = store.getAgent(caller.agentId);
  if (department === undefined || lead === undefined) return undefined;
  const workers = store.listMembers(department.id).filter((member) => member.id !== lead.id);
  return { department, lead, goal: task.prompt, workers };
}

// A harness reads its tools once, when its session starts: a lead sees them from its first
// session on, and they refuse until its team is approved.
const isLead =
  ({ store }: TeamContext) =>
  (caller: Caller) =>
    leadsTeam(store, caller);

const NOT_YET = "Your team is not approved yet. Wait for the user to answer your proposal.";

// A worker starts on its piece in a session of its own, or continues the one it has in this task:
// a message if it is open, a resume if it ended. Workers run at the same time.
async function startWork(
  context: TeamContext,
  team: LedTeam,
  caller: Caller,
  worker: AgentRecord,
  work: string,
): Promise<SessionRecord> {
  const { store, registry } = context;
  const lead = { id: team.lead.id, name: team.lead.name };
  const earlier = latestSession(context, caller.taskId, worker.id);
  if (earlier !== undefined && isOpen(earlier)) {
    try {
      await registry.tell(earlier.id, nextWork(lead, work));
      return earlier;
    } catch (error) {
      // It was being stopped for being idle: it is resumed instead.
      if (!(error instanceof SessionNotRunningError)) throw error;
    }
  }
  if (earlier?.harnessSessionId !== undefined) {
    try {
      return await registry.resume(earlier.id, nextWork(lead, work));
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
      readOnlyPaths: readOnlyFoldersOfTask(store, caller.taskId),
    }),
    message: workerBrief({
      goal: team.goal,
      teamName: team.department.name,
      role: worker.role ?? "worker",
      lead,
      folders: [folders.workspacePath ?? "", ...folders.additionalPaths],
      branch,
      instructions: settingsOf(store, worker).instructions,
      work,
    }),
  });
}

// Only the lead hands out work, and only to its own workers; workers cannot hire (MODULES M4.5).
export function delegate(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "delegate",
    description:
      "Hand one of your workers a piece of work. The brief must stand alone: the worker knows " +
      "the team's goal but nothing of your conversation. It returns at once; the worker's " +
      "result reaches you later as a message. Workers run at the same time.",
    input: z.object({
      agent: z.string().min(1).describe("The worker's name, such as @ben-1042."),
      brief: z.string().min(1).describe("What to do, what to hand back, and any constraints."),
    }),
    offeredTo: isLead(context),
    async call({ agent, brief }, caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const worker = team.workers.find((member) => member.name === agent);
      if (worker === undefined) {
        const names = team.workers.map((member) => member.name).join(", ") || "none yet";
        throw new ToolError(`${agent} is not on your team. Your workers: ${names}.`);
      }
      const earlier = latestSession(context, caller.taskId, worker.id);
      if (earlier !== undefined && store.workingDelegation(earlier.id) !== undefined) {
        throw new ToolError(
          `${worker.name} is still working on its last piece. Its result will reach you as a message.`,
        );
      }
      const session = await startWork(context, team, caller, worker, brief);
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
    const piece =
      working.brief.length > SHOWN_BRIEF
        ? `${working.brief.slice(0, SHOWN_BRIEF)}…`
        : working.brief;
    return `is working on "${piece}" (for ${minutes} min)`;
  }
  if (isOpen(session) && activity.of(session.id)?.turnOpen) return "is at work";
  return session.status === "failed" ? "failed on its last piece" : "has finished its last piece";
}

export function teamStatus(context: TeamContext, activity: SessionActivity) {
  const { store } = context;
  return defineTool({
    name: "team_status",
    description: "List your workers, what each is doing now, and the work still out with them.",
    input: z.object({}),
    offeredTo: isLead(context),
    call(_, caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const waiting = new Set(
        store.listPendingRequests().requests.map(({ event }) => event.sessionId),
      );
      const lines = team.workers.map((worker) => {
        const { harness, model } = settingsOf(store, worker);
        const runs = `${harness}${model ? `, ${model}` : ""}`;
        return `- ${worker.name}, ${worker.role ?? "worker"} (${runs}): ${stateOf(context, activity, caller, worker, waiting)}`;
      });
      const open = store.listDelegations(caller.taskId).filter((one) => one.status === "working");
      return `${team.department.name}:\n${lines.join("\n") || "No workers yet."}\n\nWork still out: ${open.length}.`;
    },
  });
}
