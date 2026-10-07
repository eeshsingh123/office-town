import type { SessionEvent, SessionRecord, TaskRecord, TaskState } from "@office-town/contract";
import { isBlocked } from "../chief/plan-graph.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";

// The events after which a task's state can change.
const STATE_EVENTS = new Set<SessionEvent["type"]>([
  "session.started",
  "session.ended",
  "turn.started",
  "turn.ended",
  "permission.requested",
  "permission.resolved",
  "question.requested",
  "question.resolved",
  "proposal.requested",
  "proposal.resolved",
  "plan.requested",
  "plan.resolved",
]);

// Whether a task still has work out, though its top agent finished at `finishedAt`.
type WorkOut = (store: Store, taskId: string, finishedAt: number) => boolean;

// A delegation still at work, cut off by a restart (Continue hands it out again), or whose result
// came after the lead last finished, so the lead has yet to act on it.
const delegationsOut: WorkOut = (store, taskId, finishedAt) =>
  store
    .listDelegations(taskId)
    .some(
      ({ status, endedAt }) =>
        status === "working" ||
        status === "interrupted" ||
        (endedAt !== undefined && Date.parse(endedAt) > finishedAt),
    );

// A chief's piece queued or at work, one waiting that can still start, or one whose result came
// after the chief last finished. A piece dropped from the plan is never out.
const piecesOut: WorkOut = (store, taskId, finishedAt) => {
  const pieces = store.listPieces(taskId);
  return pieces.some(
    (piece) =>
      piece.status === "working" ||
      piece.status === "queued" ||
      (piece.status === "waiting" && !isBlocked(piece, pieces)) ||
      (piece.status !== "dropped" &&
        piece.endedAt !== undefined &&
        Date.parse(piece.endedAt) > finishedAt),
  );
};

const workOutChecks: WorkOut[] = [delegationsOut, piecesOut];

// The store's turn record serves sessions that are open and those cut off by a restart alike, and
// is current whichever listener runs first.
function isWorking(store: Store, session: SessionRecord): boolean {
  if (session.status === "starting") return true;
  return session.status === "running" && store.latestTurn(session.id)?.ended !== true;
}

// When the task's top agent (its lead, or else its first agent) last finished: its latest session
// ended, or that session's latest turn did. A session cut off by a restart mid-turn never finished.
function finishedAt(store: Store, task: TaskRecord, sessions: SessionRecord[]): number | undefined {
  const topAgent = task.leadAgentId ?? sessions[0]?.agentId;
  const latest = sessions.findLast((session) => session.agentId === topAgent);
  if (latest === undefined) return undefined;
  if (latest.endedAt !== undefined && latest.status !== "interrupted") {
    return Date.parse(latest.endedAt);
  }
  const turn = store.latestTurn(latest.id);
  return turn?.ended ? Date.parse(turn.at) : undefined;
}

function stateOf(store: Store, task: TaskRecord): TaskState {
  const sessions = store.listSessions(task.id);
  // A task is made to start its first agent at once, so it keeps the state it was made with.
  if (sessions.length === 0) return task.state;
  const asking = store.listPendingRequests().requests.some(({ taskId }) => taskId === task.id);
  if (asking) return "waiting";
  if (sessions.some((session) => isWorking(store, session))) return "working";
  const finished = finishedAt(store, task, sessions);
  if (finished === undefined) return "idle";
  return workOutChecks.some((check) => check(store, task.id, finished)) ? "idle" : "ended";
}

// Keeps every task's state current: after each event that can change it, and each change to the
// task, its delegations or its plan, including the interruptions a restart records.
export class TaskStates {
  readonly #store: Store;

  // Subscribes before the registry exists, so it hears the restart's interruptions.
  constructor(store: Store) {
    this.#store = store;
    store.subscribe((change) => {
      if (change.type === "task") this.#update(change.task.id);
      if (change.type === "delegation") this.#update(change.delegation.taskId);
      if (change.type === "piece") this.#update(change.piece.taskId);
    });
  }

  follow(registry: SessionRegistry): void {
    registry.subscribe(({ event }) => {
      if (!STATE_EVENTS.has(event.type)) return;
      const taskId = this.#store.getSession(event.sessionId)?.taskId;
      if (taskId !== undefined) this.#update(taskId);
    });
  }

  #update(taskId: string): void {
    const task = this.#store.getTask(taskId);
    if (task !== undefined) this.#store.setTaskState(taskId, stateOf(this.#store, task));
  }
}
