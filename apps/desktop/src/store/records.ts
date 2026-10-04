import type {
  PendingRequest,
  SessionRecord,
  TaskRecord,
  TaskSummary,
  UserRequestEvent,
} from "@office-town/contract";
import type { StreamedEvent } from "../api/event-stream.ts";

export interface TaskEntry {
  task: TaskRecord;
  // In the order they started; each one after the first resumed an earlier one.
  sessionIds: string[];
}

export interface WaitingRequest {
  position: number;
  event: UserRequestEvent;
}

// The functions here return exactly these fields, so a result merges into the app's state as is.
export interface Records {
  tasks: Record<string, TaskEntry>;
  sessions: Record<string, SessionRecord>;
  // Requests no one has answered yet, by `waitingKey`.
  waiting: Record<string, WaitingRequest>;
}

export const waitingKey = (sessionId: string, requestId: string) => `${sessionId}/${requestId}`;

export function addTasks(records: Records, summaries: readonly TaskSummary[]): Records {
  const tasks = { ...records.tasks };
  const sessions = { ...records.sessions };
  for (const { sessions: taskSessions, ...task } of summaries) {
    tasks[task.id] = { task, sessionIds: taskSessions.map((session) => session.id) };
    for (const session of taskSessions) sessions[session.id] = session;
  }
  return { tasks, sessions, waiting: records.waiting };
}

export function removeTask(records: Records, taskId: string): Records {
  const entry = records.tasks[taskId];
  if (entry === undefined) return records;
  const { [taskId]: _, ...tasks } = records.tasks;
  const sessions = { ...records.sessions };
  for (const id of entry.sessionIds) delete sessions[id];
  return { tasks, sessions, waiting: records.waiting };
}

export function waitingFrom(requests: readonly PendingRequest[]): Record<string, WaitingRequest> {
  return Object.fromEntries(
    requests.map(({ position, event }) => [
      waitingKey(event.sessionId, event.payload.requestId),
      { position, event },
    ]),
  );
}

export const isOpen = (session: SessionRecord) =>
  session.status === "starting" || session.status === "running";

// Keeps session records and the waiting requests current from the live stream. Events of a
// session the app does not know yet are left out; the caller loads that session instead.
// A status only moves forward, so an event applied again over a newer record changes nothing.
export function applyToRecords(records: Records, events: readonly StreamedEvent[]): Records {
  const sessions = { ...records.sessions };
  const waiting = { ...records.waiting };
  for (const { position, event } of events) {
    const session = sessions[event.sessionId];
    if (session === undefined) continue;
    switch (event.type) {
      case "session.started":
        if (session.status !== "starting") break;
        sessions[session.id] = {
          ...session,
          status: "running",
          harnessSessionId: event.payload.harnessSessionId,
        };
        break;
      case "session.ended":
        if (!isOpen(session)) break;
        sessions[session.id] = {
          ...session,
          status: event.payload.reason,
          endedAt: event.timestamp,
        };
        for (const key of Object.keys(waiting)) {
          if (waiting[key]?.event.sessionId === session.id) delete waiting[key];
        }
        break;
      case "permission.requested":
      case "question.requested":
        if (position !== undefined) {
          waiting[waitingKey(session.id, event.payload.requestId)] = { position, event };
        }
        break;
      case "permission.resolved":
      case "question.resolved":
        delete waiting[waitingKey(session.id, event.payload.requestId)];
        break;
    }
  }
  return { tasks: records.tasks, sessions, waiting };
}
