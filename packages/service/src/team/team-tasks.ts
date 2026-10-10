import type {
  DelegationRecord,
  EnvironmentSpec,
  SessionRecord,
  StartTeamTaskRequest,
} from "@office-town/contract";
import { listHarnesses } from "@office-town/harness";
import { createAgent } from "../agents/agents.ts";
import { instructionsFor } from "../agents/briefs.ts";
import { inFolders, sessionOptionsFor } from "../agents/options.ts";
import { pieceResult } from "../chief/briefs.ts";
import { isChiefTask } from "../chief/chief.ts";
import { departmentNameOf } from "../chief/piece-folders.ts";
import { type Message, SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { startFirstAgent } from "../task-start.ts";
import { type HarnessChoices, leadBrief, proposeTeamBrief } from "./briefs.ts";
import { isOpen, latestSession } from "./lead.ts";
import {
  DepartmentBusyError,
  rosterOf,
  type TeamContext,
  TeamError,
  workspaceFolders,
} from "./members.ts";
import { isRepository } from "./worktrees.ts";

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
  // The chief's goal and the results this piece builds on.
  handOff: string;
  readOnlyPaths: string[];
  // Called before the lead starts.
  onTaskCreated(taskId: string): void;
  // False once the chief's goal was stopped.
  stillWanted(): boolean;
}

function withHandOff(message: Message, piece: PieceStart | undefined): Message {
  return piece === undefined
    ? message
    : {
        ...message,
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
  { goal, team }: StartTeamTaskRequest,
  piece?: PieceStart,
): Promise<SessionRecord> {
  const { store, registry } = context;
  const placement = piece === undefined ? {} : { parentTaskId: piece.parentTaskId };
  const readOnlyPaths = piece?.readOnlyPaths;
  if ("departmentId" in team) {
    const department = store.getDepartment(team.departmentId);
    if (department === undefined) throw new RecordNotFoundError("department", team.departmentId);
    return claimDepartment(context, department.id, undefined, async () => {
      const folders = workspaceFolders(store, department.workspaceId);
      const lead = store.getAgent(department.leadAgentId);
      if (lead === undefined) throw new RecordNotFoundError("agent", department.leadAgentId);
      const task = store.createTask(
        goal,
        { leadAgentId: lead.id, departmentId: department.id },
        placement,
      );
      piece?.onTaskCreated(task.id);
      return startFirstAgent(store, task.id, async () => {
        requireWanted(piece);
        return registry.start({
          taskId: task.id,
          agentId: lead.id,
          options: sessionOptionsFor(store, lead, { ...inFolders(folders), readOnlyPaths }),
          message: withHandOff(
            leadBrief({
              goal,
              teamName: department.name,
              folders,
              instructions: instructionsFor(store, lead),
              roster: rosterOf(store, department),
              branches: department.branchPerWorker && isRepository(folders[0] ?? ""),
              codeFlow: department.codeFlow,
            }),
            piece,
          ),
        });
      });
    });
  }
  const folders = workspaceFolders(store, team.workspaceId);
  const lead = createAgent(store, team.lead, { role: "Lead", autonomy: team.autonomy });
  const options = sessionOptionsFor(store, lead, { ...inFolders(folders), readOnlyPaths });
  const task = store.createTask(
    goal,
    { leadAgentId: lead.id, setup: { workspaceId: team.workspaceId, autonomy: team.autonomy } },
    placement,
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
    );
    requireWanted(piece);
    return registry.start({ taskId: task.id, agentId: lead.id, options, message });
  });
}

// Delegations close first, so no "stopped" result wakes the lead being stopped too.
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
    const message: Message =
      notices.length === 0
        ? { text: prompt || "Continue where you left off." }
        : { text: `${notices.join("\n\n")}${added}`, origin: { kind: "notice", summary } };
    // Resumed first, so the goal is at work again before the cut-off work stops counting as out.
    const resumed = registry.resume(lead.id, message);
    for (const delegation of cut) store.endDelegation(delegation.id, "stopped");
    return resumed;
  });
}
