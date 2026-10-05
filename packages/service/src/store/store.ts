import type {
  AgentColour,
  AgentRecord,
  AgentSettings,
  PendingRequestList,
  ProfileRecord,
  ProfileRequest,
  SessionEvent,
  SessionOptions,
  SessionRecord,
  Settings,
  StoreSize,
  TaskPage,
  TaskRecord,
  TaskSummary,
  WorkspaceRecord,
  WorkspaceRequest,
} from "@office-town/contract";

export interface NewSession {
  id: string;
  taskId: string;
  agentId: string;
  options: SessionOptions;
  resumedFrom?: string;
}

export interface NewAgentRecord {
  name: string;
  colour: AgentColour;
  role?: string;
  profileId?: string;
  settings: AgentSettings;
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
  // Newest first, each with its sessions.
  listTasks(query: TaskQuery): TaskPage;
  // Every task with a session starting or running, newest first.
  listActiveTasks(): TaskSummary[];
  // An agent that worked on no other task is deleted with it.
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
  // Every permission request and question no one has answered yet, across all sessions.
  listPendingRequests(): PendingRequestList;
  createAgent(agent: NewAgentRecord): AgentRecord;
  getAgent(id: string): AgentRecord | undefined;
  isNameTaken(name: string): boolean;
  listAgents(): AgentRecord[];
  renameAgent(id: string, name: string): AgentRecord;
  createProfile(profile: ProfileRequest): ProfileRecord;
  getProfile(id: string): ProfileRecord | undefined;
  // By name.
  listProfiles(): ProfileRecord[];
  updateProfile(id: string, profile: ProfileRequest): ProfileRecord;
  // Agents made from it keep working with the settings it had when they were made.
  deleteProfile(id: string): void;
  createWorkspace(workspace: WorkspaceRequest): WorkspaceRecord;
  // Most recently used first.
  listWorkspaces(): WorkspaceRecord[];
  updateWorkspace(id: string, workspace: WorkspaceRequest): WorkspaceRecord;
  deleteWorkspace(id: string): void;
  // Returns the workspace and moves it to the top of the list.
  useWorkspace(id: string): WorkspaceRecord;
  readSettings(): Settings;
  // Only the settings given change.
  saveSettings(settings: Settings): void;
  size(): Promise<StoreSize>;
  close(): void;
}

export class RecordNotFoundError extends Error {
  constructor(kind: "task" | "session" | "result" | "workspace" | "agent" | "profile", id: string) {
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

export class NameTakenError extends Error {
  constructor(name: string) {
    super(`Another agent is already called ${name}.`);
    this.name = "NameTakenError";
  }
}

export class StoreFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreFileError";
  }
}
