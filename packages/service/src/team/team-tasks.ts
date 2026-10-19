import type {
  Attachment,
  DelegationRecord,
  EnvironmentSpec,
  SessionRecord,
  StartTeamTaskRequest,
} from "@office-town/contract";
import { listHarnesses } from "@office-town/harness";
import { createAgent } from "../agents/agents.ts";
import { instructionsFor } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { resolveAttachments } from "../attachments/attachments.ts";
import { pieceResult } from "../chief/briefs.ts";
import { isChiefTask } from "../chief/chief.ts";
import { departmentNameOf } from "../chief/piece-folders.ts";
import { type Message, SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { foldersForTask, type TaskFolders } from "../task-folders.ts";
import { startFirstAgent } from "../task-start.ts";
import { type HarnessChoices, leadBrief, proposeTeamBrief } from "./briefs.ts";
import { busyAgents, groupName, isOpen, latestSession } from "./lead.ts";
import {
  DepartmentBusyError,
  describeWorkers,
  rosterOf,
  type TeamContext,
  TeamError,
} from "./members.ts";
import { removeCopies } from "./outsource.ts";
import { isRepository, removeWorktrees } from "./worktrees.ts";

const SHOWN_BRIEF = 120;

// Each harness that can list its models where the lead runs.
export async function harnessChoices(
  { readCatalog }: TeamContext,
  environment: EnvironmentSpec,
): Promise<HarnessChoices[]> {
  const harnesses = listHarnesses();
  const catalogs = await Promise.allSettled(
    harnesses.map((harness) => readCatalog(harness.harness, environment)),
  );
  return harnesses.flatMap((harness, index) => {
    const catalog = catalogs[index];
    return catalog?.status === "fulfilled" ? [{ harness, models: catalog.value.models }] : [];
  });
}

// The store shows a goal busy only once its agent has a session, so a claim covers the start before.
const claims = new Map<string, { taskId: string | undefined; holders: number }>();

function claimedByOther(id: string, taskId: string | undefined): boolean {
  const claim = claims.get(id);
  return claim !== undefined && (claim.taskId === undefined || claim.taskId !== taskId);
}

export function isClaimed(id: string): boolean {
  return claims.has(id);
}

function hold(ids: string[], taskId: string | undefined): () => void {
  for (const id of ids) {
    const claim = claims.get(id) ?? { taskId, holders: 0 };
    claims.set(id, { ...claim, holders: claim.holders + 1 });
  }
  return () => {
    for (const id of ids) {
      const claim = claims.get(id);
      if (claim === undefined) continue;
      if (claim.holders > 1) claims.set(id, { ...claim, holders: claim.holders - 1 });
      else claims.delete(id);
    }
  };
}

// An ended goal is taken up again only while no other chief goal runs (D-49).
function claimChief(store: Store, taskId: string | undefined): string[] {
  const leadId = taskId === undefined ? undefined : store.getTask(taskId)?.leadAgentId;
  if (leadId === undefined || leadId !== store.readSettings().chiefAgentId) return [];
  const open = store.openTaskOfLead(leadId);
  if ((open !== undefined && open !== taskId) || claimedByOther(leadId, taskId)) {
    throw new DepartmentBusyError("The chief");
  }
  return [leadId];
}

// One goal per department (D-41). Check and claim happen at once, so two starts never both pass.
export async function claimDepartment<T>(
  { store, registry }: TeamContext,
  departmentId: string | undefined,
  taskId: string | undefined,
  start: () => Promise<T>,
): Promise<T> {
  const ids = claimChief(store, taskId);
  if (departmentId !== undefined) {
    const active = store.activeTaskOf(departmentId);
    if ((active !== undefined && active !== taskId) || claimedByOther(departmentId, taskId)) {
      throw new DepartmentBusyError(store.getDepartment(departmentId)?.name ?? "The department");
    }
    ids.push(departmentId);
  }
  const release = hold(ids, taskId);
  try {
    if (departmentId !== undefined) {
      const leftOpen = store
        .listActiveTasks()
        .filter((task) => task.departmentId === departmentId && task.id !== taskId)
        .flatMap((task) => task.sessions.filter(isOpen));
      const stops = await Promise.allSettled(
        leftOpen.map((session) => registry.stop(session.id, true)),
      );
      throwUnlessStopped(stops, "Some agents of an earlier goal could not be stopped.");
    }
    return await start();
  } finally {
    release();
  }
}

// An agent that ended on its own in the meantime has nothing left to stop.
function throwUnlessStopped(stops: PromiseSettledResult<void>[], message: string): void {
  const failures = stops.flatMap((stop) =>
    stop.status === "rejected" && !(stop.reason instanceof SessionNotRunningError)
      ? [stop.reason]
      : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, message);
}

export interface PieceStart {
  parentTaskId: string;
  // The files given with the chief's goal.
  attachments: Attachment[];
  // The chief's goal and the results this piece builds on.
  handOff: string;
  readOnlyPaths: string[];
  // Called before the lead starts.
  onTaskCreated(taskId: string): void;
  // False once the chief's goal was stopped.
  stillWanted(): boolean;
}

function withHandOff(
  message: Message,
  piece: PieceStart | undefined,
  attachments: Attachment[],
): Message {
  const given = attachments.length === 0 ? message : { ...message, attachments };
  return piece === undefined
    ? given
    : {
        ...given,
        text: `${message.text}

${piece.handOff}`,
      };
}

function requireWanted(piece: PieceStart | undefined): void {
  if (piece !== undefined && !piece.stillWanted()) {
    throw new TeamError("The chief's goal was stopped before this piece started.");
  }
}

// A new lead first proposes its team; only the lead starts, as it hands out the work.
export async function startTeamTask(
  context: TeamContext,
  { goal, team, attachments: attachmentIds }: StartTeamTaskRequest,
  piece?: PieceStart,
): Promise<SessionRecord> {
  const { store, registry } = context;
  const attachments = [...resolveAttachments(store, attachmentIds), ...(piece?.attachments ?? [])];
  const parent = piece === undefined ? {} : { parentTaskId: piece.parentTaskId };
  // The upstream departments' folders a piece of a chief's plan may read.
  const withUpstream = (folders: TaskFolders) => ({
    ...folders,
    readOnlyPaths: [...new Set([...folders.readOnlyPaths, ...(piece?.readOnlyPaths ?? [])])],
  });
  if ("workerAgentIds" in team) {
    if (piece !== undefined)
      throw new TeamError("A part of the chief's plan goes to a department.");
    return startGroupTask(context, goal, team, attachments);
  }
  if ("departmentId" in team) {
    const department = store.getDepartment(team.departmentId);
    if (department === undefined) throw new RecordNotFoundError("department", team.departmentId);
    const workspaceId = team.workspaceId ?? department.workspaceId;
    if (!department.workspaceIds.includes(workspaceId)) {
      throw new TeamError(`${department.name} does not work in that workspace.`);
    }
    return claimDepartment(context, department.id, undefined, async () => {
      const lead = store.getAgent(department.leadAgentId);
      if (lead === undefined) throw new RecordNotFoundError("agent", department.leadAgentId);
      const folders = foldersForTask(store, workspaceId, goal);
      const task = store.createTask(
        goal,
        { leadAgentId: lead.id, departmentId: department.id },
        { ...parent, workspaceId },
      );
      piece?.onTaskCreated(task.id);
      return startFirstAgent(store, task.id, async () => {
        requireWanted(piece);
        return registry.start({
          taskId: task.id,
          agentId: lead.id,
          options: sessionOptionsFor(store, lead, withUpstream(folders)),
          message: withHandOff(
            leadBrief({
              goal,
              teamName: department.name,
              folders,
              instructions: instructionsFor(store, lead),
              roster: rosterOf(store, department),
              branches: department.branchPerWorker && isRepository(folders.workspacePath),
              codeFlow: department.codeFlow,
            }),
            piece,
            attachments,
          ),
        });
      });
    });
  }
  const folders = foldersForTask(store, team.workspaceId, goal);
  const lead = createAgent(store, team.lead, { role: "Lead", autonomy: team.autonomy });
  const options = sessionOptionsFor(store, lead, withUpstream(folders));
  const task = store.createTask(
    goal,
    { leadAgentId: lead.id, setup: { workspaceId: team.workspaceId, autonomy: team.autonomy } },
    { ...parent, workspaceId: team.workspaceId },
  );
  piece?.onTaskCreated(task.id);
  return startFirstAgent(store, task.id, async () => {
    const message = withHandOff(
      proposeTeamBrief({
        goal,
        folders,
        instructions: instructionsFor(store, lead),
        choices: await harnessChoices(context, options.environment),
      }),
      piece,
      attachments,
    );
    requireWanted(piece);
    return registry.start({ taskId: task.id, agentId: lead.id, options, message });
  });
}

type GroupTeam = Extract<StartTeamTaskRequest["team"], { workerAgentIds: string[] }>;

function groupOf(store: Store, { leadAgentId, workerAgentIds }: GroupTeam) {
  const ids = [leadAgentId, ...workerAgentIds];
  if (new Set(ids).size !== ids.length) throw new TeamError("Each agent can be picked once.");
  const agents = ids.map((id) => {
    const agent = store.getAgent(id);
    if (agent === undefined) throw new RecordNotFoundError("agent", id);
    return agent;
  });
  const chiefId = store.readSettings().chiefAgentId;
  if (agents.some((agent) => agent.guest === true || agent.id === chiefId)) {
    throw new TeamError("The chief and reviewers cannot join a group task.");
  }
  const [lead, ...workers] = agents;
  if (lead === undefined) throw new RecordNotFoundError("agent", leadAgentId);
  return { lead, workers };
}

// Agents the user picked on the floor, each on its own settings, in one workspace (D-63).
async function startGroupTask(
  context: TeamContext,
  goal: string,
  team: GroupTeam,
  attachments: Attachment[],
): Promise<SessionRecord> {
  const { store, registry } = context;
  const { lead, workers } = groupOf(store, team);
  const ids = [lead.id, ...workers.map((worker) => worker.id)];
  const busy = [...busyAgents(store, ids), ...ids.filter((id) => isClaimed(id))];
  if (busy.length > 0) {
    const names = [...new Set(busy)].map((id) => store.getAgent(id)?.name ?? id);
    throw new TeamError(`Busy on another task: ${names.join(", ")}.`);
  }
  const release = hold(ids, undefined);
  try {
    const folders = foldersForTask(store, team.workspaceId, goal);
    const task = store.createTask(
      goal,
      { leadAgentId: lead.id, workerAgentIds: team.workerAgentIds },
      { workspaceId: team.workspaceId },
    );
    return await startFirstAgent(store, task.id, () =>
      registry.start({
        taskId: task.id,
        agentId: lead.id,
        options: sessionOptionsFor(store, lead, folders),
        message: withHandOff(
          leadBrief({
            goal,
            teamName: groupName(lead),
            folders,
            instructions: instructionsFor(store, lead),
            roster: describeWorkers(store, workers),
            branches: false,
            codeFlow: false,
            fixedTeam: true,
          }),
          undefined,
          attachments,
        ),
      }),
    );
  } finally {
    release();
  }
}

// Delegations close first, so no "stopped" result wakes the lead being stopped too.
// With the worktrees and review copies made for it.
export async function deleteTask(context: TeamContext, taskId: string): Promise<void> {
  await removeWorktrees(context, taskId);
  removeCopies(context, taskId);
  await context.store.deleteTask(taskId);
}

export async function stopTeam({ store, registry }: TeamContext, taskId: string): Promise<void> {
  for (const delegation of store.listDelegations(taskId)) {
    if (delegation.status === "working") store.endDelegation(delegation.id, "stopped");
  }
  const stops = await Promise.allSettled(
    store
      .listSessions(taskId)
      .filter(isOpen)
      .map((session) => registry.stop(session.id)),
  );
  throwUnlessStopped(stops, "Some members could not be stopped.");
}

function cutOffNotice(store: Store, cut: DelegationRecord[]): string {
  const lines = cut.map((delegation) => {
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const brief =
      delegation.brief.length > SHOWN_BRIEF
        ? `${delegation.brief.slice(0, SHOWN_BRIEF)}…`
        : delegation.brief;
    return `- ${name}: ${brief}`;
  });
  return `Office Town was closed while your team worked, and this work was cut off before it finished:\n${lines.join("\n")}\n\nHand it out again with delegate if it is still needed.`;
}

// Pieces that ended after the chief's latest session did, so it never got their results.
function missedResults(store: Store, taskId: string, chief: SessionRecord): string[] {
  if (!isChiefTask(store, taskId)) return [];
  const since = Date.parse(chief.endedAt ?? store.latestTurn(chief.id)?.at ?? chief.createdAt);
  return store.listPieces(taskId).flatMap((piece) => {
    const { status, endedAt } = piece;
    if (status !== "done" && status !== "failed" && status !== "stopped") return [];
    if (endedAt === undefined || Date.parse(endedAt) <= since) return [];
    return [pieceResult(departmentNameOf(store, piece), piece.title, status, piece.result ?? "")];
  });
}

// Resumes the lead after a restart, told which work was cut off and, for the chief, missed results.
export async function continueTeam(
  context: TeamContext,
  taskId: string,
  prompt: string | undefined,
  attachments: Attachment[] = [],
): Promise<SessionRecord> {
  const { store, registry } = context;
  const task = store.getTask(taskId);
  if (task === undefined) throw new RecordNotFoundError("task", taskId);
  if (task.leadAgentId === undefined) throw new TeamError("This task has no team to continue.");
  const lead = latestSession(context, taskId, task.leadAgentId);
  if (lead === undefined) throw new TeamError("This task's lead never started.");
  if (isOpen(lead)) throw new TeamError("The lead is already at work.");
  return claimDepartment(context, task.departmentId, taskId, async () => {
    const cut = store.listDelegations(taskId).filter((one) => one.status === "interrupted");
    const missed = missedResults(store, taskId, lead);
    const notices = [
      ...(cut.length === 0 ? [] : [cutOffNotice(store, cut)]),
      ...(missed.length === 0
        ? []
        : [
            `While you were not running, these pieces of your plan ended:\n\n${missed.join("\n\n")}`,
          ]),
    ];
    const added = prompt === undefined || prompt === "" ? "" : `\n\nThe user adds: ${prompt}`;
    const summary =
      cut.length > 0
        ? `Work cut off by a restart: ${cut.length}`
        : `Results that came while you were not running: ${missed.length}`;
    const message: Message = {
      ...(notices.length === 0
        ? { text: prompt || "Continue where you left off." }
        : { text: `${notices.join("\n\n")}${added}`, origin: { kind: "notice", summary } }),
      ...(attachments.length === 0 ? {} : { attachments }),
    };
    // Resumed first, so the goal is at work again before the cut-off work stops counting as out.
    const resumed = registry.resume(lead.id, message);
    for (const delegation of cut) store.endDelegation(delegation.id, "stopped");
    return resumed;
  });
}
