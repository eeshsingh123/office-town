import type { AgentRecord, TaskSummary } from "@office-town/contract";
import { api } from "../api/client.ts";
import { followEvents, replaySession, type StreamedEvent } from "../api/event-stream.ts";
import { applyEvents, emptyTrace } from "../trace/trace.ts";
import { useApp } from "./app-store.ts";
import { addTasks, applyToRecords, isOpen, removeTask, waitingFrom } from "./records.ts";

const RETRY_MS = 2000;
const FLUSH_FALLBACK_MS = 100;

let queue: StreamedEvent[] = [];
let scheduled = false;
let cancelFlush = () => {};
// Live events of a session whose trace is being replayed, applied once the replay is in.
const loading = new Map<string, StreamedEvent[]>();
// Live events of a session being looked up, applied to its record once it is known.
const discovering = new Map<string, StreamedEvent[]>();
// Replays run one at a time: the browser allows only six connections to the core (D-32).
let replays = Promise.resolve();

// Opens the app's one live stream. Called once, when the page loads.
export function connect(): void {
  let wasOffline = false;
  const onStatus = (status: "connecting" | "live" | "offline") => {
    useApp.setState({ connection: status });
    if (status === "offline") wasOffline = true;
    // A core restarted meanwhile has marked its agents interrupted without an event.
    if (status === "live" && wasOffline) {
      wasOffline = false;
      void refresh().catch((error: unknown) => console.error("Could not refresh.", error));
    }
  };
  const open = async (): Promise<void> => {
    try {
      const after = await refresh(true);
      followEvents({ after, onEvent: enqueue, onStatus });
    } catch (error) {
      console.warn("The core is not reachable yet; retrying.", error);
      useApp.setState({ connection: "offline" });
      setTimeout(open, RETRY_MS);
    }
  };
  void open();
}

// Reads what is true now. The waiting list is read first: the stream opens at its position, and
// anything that changes after it arrives as an event.
async function refresh(first = false): Promise<number> {
  const waiting = await api.listPendingRequests();
  const [page, active, harnesses, agents] = await Promise.all([
    api.listTasks(),
    api.listActiveTasks(),
    api.listHarnesses(),
    api.listAgents(),
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
  useApp.setState((state) => ({
    harnesses,
    agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    ...addTasks(state, tasks),
    waiting: waitingFrom(waiting.requests),
    ...(first ? { olderTasks: page.next } : {}),
  }));
  for (const { event } of waiting.requests) {
    if (useApp.getState().sessions[event.sessionId] === undefined) discover(event.sessionId);
  }
  watchActive(tasks);
  return waiting.position;
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
    agents: { ...state.agents, ...Object.fromEntries(agents.map((agent) => [agent.id, agent])) },
  }));
  watchActive([summary]);
}

export async function deleteTask(taskId: string): Promise<void> {
  await api.deleteTask(taskId);
  useApp.setState((state) => {
    const sessionIds = new Set(state.tasks[taskId]?.sessionIds);
    const traces = Object.fromEntries(
      Object.entries(state.traces).filter(([sessionId]) => !sessionIds.has(sessionId)),
    );
    return { ...removeTask(state, taskId), traces };
  });
}

export async function loadOlderTasks(): Promise<void> {
  const cursor = useApp.getState().olderTasks;
  if (cursor === undefined) return;
  const page = await api.listTasks(cursor);
  const agents = await readAgents(page.tasks);
  useApp.setState((state) => ({
    ...addTasks(state, page.tasks),
    agents: { ...state.agents, ...Object.fromEntries(agents.map((agent) => [agent.id, agent])) },
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

// Applies everything that arrived since the last frame in one update (D-37).
function flush(): void {
  cancelFlush();
  scheduled = false;
  const events = queue;
  queue = [];
  const state = useApp.getState();
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
  const traces = { ...state.traces };
  for (const [sessionId, batch] of forTraces) {
    const trace = traces[sessionId];
    if (trace !== undefined) traces[sessionId] = applyEvents(trace, batch);
  }
  useApp.setState({ ...applyToRecords(state, events), traces });
}
