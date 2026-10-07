import type {
  AgentRecord,
  Change,
  DelegationRecord,
  PlanPiece,
  RoomPosition,
  TaskSummary,
} from "@office-town/contract";
import { api } from "../api/client.ts";
import { followEvents, replaySession, type StreamedEvent } from "../api/event-stream.ts";
import { applyEvents, emptyTrace } from "../trace/trace.ts";
import { useApp } from "./app-store.ts";
import { applyChanges, withoutTask } from "./changes.ts";
import { addTasks, applyToRecords, isOpen, waitingFrom } from "./records.ts";

const RETRY_MS = 2000;
const FLUSH_FALLBACK_MS = 100;

let queue: StreamedEvent[] = [];
let changes: Change[] = [];
let scheduled = false;
let cancelFlush = () => {};
// Refreshes running. Change frames have no position and are never replayed, so what the stream
// delivers while the lists are read is held and applied on top of them.
let refreshing = 0;
// Live events of a session whose trace is being replayed, applied once the replay is in.
const loading = new Map<string, StreamedEvent[]>();
// Live events of a session being looked up, applied to its record once it is known.
const discovering = new Map<string, StreamedEvent[]>();
// Replays run one at a time: the browser allows only six connections to the core (D-32).
let replays = Promise.resolve();

// Opens the app's one live stream. Called once, when the page loads.
export function connect(): void {
  let wasOffline = false;
  let following = false;
  const onStatus = (status: "connecting" | "live" | "offline") => {
    useApp.setState({ connection: status });
    if (status === "offline") wasOffline = true;
    // A core restarted meanwhile has marked its agents interrupted without an event.
    if (status === "live" && wasOffline) {
      wasOffline = false;
      void refresh().catch((error: unknown) => console.error("Could not refresh.", error));
    }
  };
  const follow = (after: number) => {
    following = true;
    followEvents({ after, onEvent: enqueue, onChange: enqueueChange, onStatus });
  };
  const open = async (): Promise<void> => {
    try {
      await refresh(following ? undefined : follow);
    } catch (error) {
      console.warn("The core is not reachable yet; retrying.", error);
      useApp.setState({ connection: "offline" });
      setTimeout(open, RETRY_MS);
    }
  };
  void open();
}

// Reads what is true now. The waiting list is read first and the stream, when not open yet,
// opens at its position; anything that changes after it arrives as an event or a change and is
// applied once the lists are in.
async function refresh(openStream?: (after: number) => void): Promise<void> {
  refreshing += 1;
  try {
    await readAll(openStream);
  } finally {
    refreshing -= 1;
    if (refreshing === 0 && (queue.length > 0 || changes.length > 0)) schedule();
  }
}

async function readAll(openStream: ((after: number) => void) | undefined): Promise<void> {
  const first = openStream !== undefined;
  const waiting = await api.listPendingRequests();
  openStream?.(waiting.position);
  const [page, active, harnesses, agents, departments, limits, settings] = await Promise.all([
    api.listTasks(),
    api.listActiveTasks(),
    api.listHarnesses(),
    api.listAgents(),
    api.listDepartments(),
    api.listLimits(),
    api.readSettings(),
  ]);
  // A task the app still holds as open, but that neither list has, may have been interrupted by a
  // core restart; it is read again so it does not stay "running".
  const listed = new Set([...page.tasks, ...active.tasks].map((task) => task.id));
  const stale = new Set(
    Object.values(useApp.getState().sessions)
      .filter((session) => isOpen(session) && !listed.has(session.taskId))
      .map((session) => session.taskId),
  );
  const reread = await Promise.all([...stale].map(readTask));
  const tasks = [...page.tasks, ...active.tasks, ...reread];
  const [delegations, pieces] = await Promise.all([
    readDelegations(tasks),
    readPlans(tasks, settings.chiefAgentId),
  ]);
  useApp.setState((state) => ({
    harnesses,
    chiefId: settings.chiefAgentId,
    roomPositions: settings.roomPositions ?? {},
    agents: byId(agents),
    departments: byId(departments),
    delegations: byId(delegations),
    pieces: byId(pieces),
    limits: Object.fromEntries(limits.map((harness) => [harness.harness, harness])),
    ...addTasks(state, tasks),
    waiting: waitingFrom(waiting.requests),
    ...(first ? { olderTasks: page.next } : {}),
  }));
  for (const { event } of waiting.requests) {
    if (useApp.getState().sessions[event.sessionId] === undefined) discover(event.sessionId);
  }
  watchActive(tasks);
}

// The delegations of every team task that has not ended; an ended one has none at work.
async function readDelegations(tasks: readonly TaskSummary[]): Promise<DelegationRecord[]> {
  const teams = tasks.filter((task) => task.leadAgentId !== undefined && task.state !== "ended");
  const ids = [...new Set(teams.map((task) => task.id))];
  return (await Promise.all(ids.map(api.listDelegations))).flat();
}

// The plans of every chief goal that has not ended; an ended one has no piece left to run.
async function readPlans(
  tasks: readonly TaskSummary[],
  chiefAgentId: string | undefined,
): Promise<PlanPiece[]> {
  if (chiefAgentId === undefined) return [];
  const goals = tasks.filter((task) => task.leadAgentId === chiefAgentId && task.state !== "ended");
  const ids = [...new Set(goals.map((task) => task.id))];
  return (await Promise.all(ids.map(api.getPlan))).flat();
}

async function readTask(taskId: string): Promise<TaskSummary> {
  const { task, sessions } = await api.getTask(taskId);
  return { ...task, sessions };
}

// Reads the agents of these tasks that the app does not know yet, such as one just made.
async function readAgents(tasks: readonly TaskSummary[]): Promise<AgentRecord[]> {
  const known = useApp.getState().agents;
  const missing = new Set(tasks.flatMap((task) => task.sessions.map((session) => session.agentId)));
  return Promise.all([...missing].filter((id) => known[id] === undefined).map(api.getAgent));
}

export function keepAgent(agent: AgentRecord): void {
  useApp.setState((state) => ({ agents: { ...state.agents, [agent.id]: agent } }));
}

const byId = <T extends { id: string }>(records: readonly T[]): Record<string, T> =>
  Object.fromEntries(records.map((record) => [record.id, record]));

function watchActive(tasks: readonly TaskSummary[]): void {
  for (const session of tasks.flatMap((task) => task.sessions)) {
    if (isOpen(session)) loadTrace(session.id);
  }
}

// Adds a task the app has not listed yet, such as one it just started.
export async function track(taskId: string): Promise<void> {
  const summary = await readTask(taskId);
  const agents = await readAgents([summary]);
  useApp.setState((state) => ({
    ...addTasks(state, [summary]),
    agents: { ...state.agents, ...byId(agents) },
  }));
  watchActive([summary]);
}

// Moves a room at once and keeps its place in the core; a failed save puts that room back.
export async function placeRoom(roomId: string, position: RoomPosition): Promise<void> {
  const before = useApp.getState().roomPositions[roomId];
  useApp.setState((state) => ({ roomPositions: { ...state.roomPositions, [roomId]: position } }));
  try {
    await api.saveRoomPosition(roomId, position);
  } catch (error) {
    useApp.setState((state) => {
      const { [roomId]: _, ...others } = state.roomPositions;
      return { roomPositions: before === undefined ? others : { ...others, [roomId]: before } };
    });
    throw error;
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  await api.deleteTask(taskId);
  useApp.setState((state) => withoutTask(state, taskId));
}

export async function loadOlderTasks(): Promise<void> {
  const cursor = useApp.getState().olderTasks;
  if (cursor === undefined) return;
  const page = await api.listTasks(cursor);
  const agents = await readAgents(page.tasks);
  useApp.setState((state) => ({
    ...addTasks(state, page.tasks),
    agents: { ...state.agents, ...byId(agents) },
    olderTasks: page.next,
  }));
}

function discover(sessionId: string, streamed?: StreamedEvent): void {
  const buffer = discovering.get(sessionId);
  if (buffer !== undefined) {
    if (streamed !== undefined) buffer.push(streamed);
    return;
  }
  discovering.set(sessionId, streamed === undefined ? [] : [streamed]);
  api
    .getSession(sessionId)
    .then((session) => track(session.taskId))
    .then(() => {
      const events = discovering.get(sessionId) ?? [];
      useApp.setState((state) => applyToRecords(state, events));
    })
    .catch((error: unknown) => console.error(`Could not load session ${sessionId}.`, error))
    .finally(() => discovering.delete(sessionId));
}

export function loadTrace(sessionId: string): void {
  if (useApp.getState().traces[sessionId] !== undefined || loading.has(sessionId)) return;
  loading.set(sessionId, []);
  replays = replays.then(async () => {
    try {
      const replayed = applyEvents(emptyTrace(sessionId), await replaySession(sessionId));
      const trace = applyEvents(replayed, loading.get(sessionId) ?? []);
      useApp.setState((state) => {
        const { [sessionId]: _, ...traceErrors } = state.traceErrors;
        return { traces: { ...state.traces, [sessionId]: trace }, traceErrors };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useApp.setState((state) => ({ traceErrors: { ...state.traceErrors, [sessionId]: message } }));
    } finally {
      loading.delete(sessionId);
    }
  });
}

function enqueue(streamed: StreamedEvent): void {
  queue.push(streamed);
  schedule();
}

function enqueueChange(change: Change): void {
  changes.push(change);
  schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // A window that is hidden or covered gets no animation frames, yet its agents keep working.
  const frame = requestAnimationFrame(flush);
  const timer = setTimeout(flush, FLUSH_FALLBACK_MS);
  cancelFlush = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

// Applies everything that arrived since the last frame in one update (D-37). Changes go first:
// they replace whole records, and the events then apply to the session records they touch.
function flush(): void {
  cancelFlush();
  scheduled = false;
  if (refreshing > 0) return;
  const events = queue;
  queue = [];
  const state = applyChanges(useApp.getState(), changes);
  changes = [];
  const forTraces = new Map<string, StreamedEvent[]>();
  for (const streamed of events) {
    const sessionId = streamed.event.sessionId;
    if (state.sessions[sessionId] === undefined) {
      discover(sessionId, streamed);
      continue;
    }
    const buffer = loading.get(sessionId);
    if (buffer !== undefined) {
      // Text fragments are dropped while a replay loads: its stored text replaces them anyway.
      if (streamed.position !== undefined) buffer.push(streamed);
      continue;
    }
    if (state.traces[sessionId] === undefined) {
      loadTrace(sessionId);
      continue;
    }
    const batch = forTraces.get(sessionId) ?? [];
    batch.push(streamed);
    forTraces.set(sessionId, batch);
  }
  const traces = forTraces.size === 0 ? state.traces : { ...state.traces };
  for (const [sessionId, batch] of forTraces) {
    const trace = traces[sessionId];
    if (trace !== undefined) traces[sessionId] = applyEvents(trace, batch);
  }
  useApp.setState({ ...state, ...applyToRecords(state, events), traces });
}
