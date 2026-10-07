import type { SessionEvent, SessionRecord, TaskRecord, TaskState } from "@office-town/contract";
import { isBlocked } from "../chief/plan-graph.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";

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

type WorkOut = (store: Store, taskId: string) => boolean;

// Cut-off delegations count, as Continue hands them out again; a result the lead never got does not.
const delegationsOut: WorkOut = (store, taskId) =>
  store
    .listDelegations(taskId)
    .some(({ status }) => status === "working" || status === "interrupted");

// A waiting piece counts only if it can still start.
const piecesOut: WorkOut = (store, taskId) => {
  const pieces = store.listPieces(taskId);
  return pieces.some(
    (piece) =>
      piece.status === "working" ||
      piece.status === "queued" ||
      (piece.status === "waiting" && !isBlocked(piece, pieces)),
  );
};

const workOutChecks: WorkOut[] = [delegationsOut, piecesOut];

// The store's turn record covers open and cut-off sessions, and is current whichever listener runs first.
function isWorking(store: Store, session: SessionRecord): boolean {
  if (session.status === "starting") return true;
  return session.status === "running" && store.latestTurn(session.id)?.ended !== true;
}

// Its lead, or else its first agent.
function topSession(task: TaskRecord, sessions: SessionRecord[]): SessionRecord | undefined {
  const topAgent = task.leadAgentId ?? sessions[0]?.agentId;
  return sessions.findLast((session) => session.agentId === topAgent);
}

// A session cut off by a restart mid-turn never finished.
function finished(store: Store, session: SessionRecord): boolean {
  if (session.endedAt !== undefined && session.status !== "interrupted") return true;
  return store.latestTurn(session.id)?.ended === true;
}

function stateOf(store: Store, task: TaskRecord): TaskState {
  const sessions = store.listSessions(task.id);
  // A task starts its first agent at once, so until then it keeps the state it was made with.
  if (sessions.length === 0) return task.state;
  const asking = store.listPendingRequests().requests.some(({ taskId }) => taskId === task.id);
  if (asking) return "waiting";
  if (sessions.some((session) => isWorking(store, session))) return "working";
  const top = topSession(task, sessions);
  if (top === undefined) return "idle";
  // A prompt or answer it has yet to act on: its next turn is about to start.
  if (top.status === "running" && store.owesTurn(top.id)) return "working";
  if (!finished(store, top)) return "idle";
  return workOutChecks.some((check) => check(store, task.id)) ? "idle" : "ended";
}

// Recomputed after each event or record change that can affect it, restart interruptions included.
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
