import type {
  SessionEvent,
  SessionOptions,
  SessionRecord,
  StoreSize,
  TaskPage,
  TaskRecord,
} from "@office-town/contract";

export interface NewSession {
  id: string;
  taskId: string;
  options: SessionOptions;
  resumedFrom?: string;
}

// `position` orders events across all sessions and is the cursor every reader resumes from.
export interface StoredEvent {
  position: number;
  event: SessionEvent;
}

export interface EventQuery {
  after: number;
  limit: number;
  sessionId?: string;
}

export interface TaskQuery {
  limit: number;
  cursor?: string;
}

export type LineDirection = "in" | "out";

// Synchronous on purpose: SQLite runs in this process and a write takes microseconds, so an async
// interface would only add a queue to keep "stored before published" in order. Deleting is the
// one long operation, so it alone is async.
export interface Store {
  createTask(prompt: string): TaskRecord;
  getTask(id: string): TaskRecord | undefined;
  // Newest first.
  listTasks(query: TaskQuery): TaskPage;
  deleteTask(id: string): Promise<void>;
  createSession(session: NewSession): SessionRecord;
  getSession(id: string): SessionRecord | undefined;
  listSessions(taskId: string): SessionRecord[];
  // Marks every session left starting or running by an earlier core as interrupted.
  markInterrupted(): SessionRecord[];
  // Returns the event as stored, or nothing for a text fragment, which is never stored.
  append(event: SessionEvent): StoredEvent | undefined;
  // A line over 64 KiB is cut: the events already hold the text, the audit copy needs its shape.
  appendHarnessLine(sessionId: string, direction: LineDirection, line: string): void;
  readEvents(query: EventQuery): StoredEvent[];
  readOverflow(sessionId: string, sequence: number): string;
  size(): Promise<StoreSize>;
  close(): void;
}

export class RecordNotFoundError extends Error {
  constructor(kind: "task" | "session" | "result", id: string) {
    super(`No ${kind} "${id}".`);
    this.name = "RecordNotFoundError";
  }
}

export class TaskActiveError extends Error {
  constructor(id: string) {
    super(`Task "${id}" still has a running session. Stop it before deleting the task.`);
    this.name = "TaskActiveError";
  }
}

export class StoreFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreFileError";
  }
}
