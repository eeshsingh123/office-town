import type {
  AgentColour,
  AgentRecord,
  AgentSettings,
  Autonomy,
  Change,
  DelegationRecord,
  DepartmentRecord,
  DepartmentSettings,
  HarnessLimits,
  PendingRequestList,
  ProfileRecord,
  ProfileRequest,
  SessionEvent,
  SessionOptions,
  SessionPage,
  SessionRecord,
  Settings,
  StoreSize,
  TaskPage,
  TaskRecord,
  TaskState,
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
  purpose?: string;
  departmentId?: string;
  autonomy?: Autonomy;
  guest?: true;
  profileId?: string;
  settings: AgentSettings;
}

// An agent's fields that can change; one left out is cleared.
export interface AgentChange {
  role?: string | undefined;
  purpose?: string | undefined;
  departmentId?: string | undefined;
  autonomy?: Autonomy | undefined;
  profileId?: string | undefined;
  settings: AgentSettings;
}

// Where a team the lead has yet to propose would work.
export interface TeamSetup {
  workspaceId: string;
  autonomy: Autonomy;
}

// A team's task: its lead, and its department or else the setup of the team to be proposed.
export type TaskTeam =
  | { leadAgentId: string; departmentId: string }
  | { leadAgentId: string; setup: TeamSetup };

export type NewDepartment = Omit<DepartmentRecord, "id" | "createdAt">;

export type NewDelegation = Pick<
  DelegationRecord,
  "taskId" | "workerAgentId" | "workerSessionId" | "brief"
>;

export type DelegationEnd = Exclude<DelegationRecord["status"], "working">;

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

export interface AgentSessionQuery {
  limit: number;
  before?: string;
}

// A session's latest turn: whether it has ended, and when it started or ended.
export interface LatestTurn {
  ended: boolean;
  at: string;
}

export type ChangeListener = (change: Change) => void;

export type LineDirection = "in" | "out";

// Synchronous on purpose: SQLite runs in this process and a write takes microseconds, so an async
// interface would only add a queue to keep "stored before published" in order. Deleting is the
// one long operation, so it alone is async.
export interface Store {
  // Hears every change to a task, agent, department, delegation or plan limit once it is
  // written, in the order written.
  subscribe(listener: ChangeListener): () => void;
  createTask(prompt: string, team?: TaskTeam): TaskRecord;
  // Set until the task's team is approved.
  taskSetup(taskId: string): TeamSetup | undefined;
  // The task's proposed team was approved as this department.
  joinDepartment(taskId: string, departmentId: string): TaskRecord;
  // The department's task with an agent at work, if any.
  activeTaskOf(departmentId: string): string | undefined;
  // Does nothing if the task is already in that state. Leaving "ended" clears its review.
  setTaskState(taskId: string, state: TaskState): void;
  markReviewed(taskId: string): TaskRecord;
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
  // The agent's sessions across all its tasks, newest first.
  listAgentSessions(agentId: string, query: AgentSessionQuery): SessionPage;
  latestTurn(sessionId: string): LatestTurn | undefined;
  // Marks every session left starting or running by an earlier core as interrupted, with the
  // delegations they were working on.
  markInterrupted(): SessionRecord[];
  createDelegation(delegation: NewDelegation): DelegationRecord;
  // Oldest first.
  listDelegations(taskId: string): DelegationRecord[];
  // The delegation a worker's session is working on, if any.
  workingDelegation(workerSessionId: string): DelegationRecord | undefined;
  endDelegation(id: string, status: DelegationEnd, result?: string): void;
  // Returns the event as stored, or nothing for a text fragment, which is never stored. A turn's
  // usage is added to its task's, and reported limits replace the harness's earlier ones.
  append(event: SessionEvent): StoredEvent | undefined;
  // A line over 64 KiB is cut: the events already hold the text, the audit copy needs its shape.
  appendHarnessLine(sessionId: string, direction: LineDirection, line: string): void;
  readEvents(query: EventQuery): StoredEvent[];
  // Each harness's latest plan limits, by harness.
  listLimits(): HarnessLimits[];
  readOverflow(sessionId: string, sequence: number): string;
  // Every permission request and question no one has answered yet, across all sessions.
  listPendingRequests(): PendingRequestList;
  createAgent(agent: NewAgentRecord): AgentRecord;
  getAgent(id: string): AgentRecord | undefined;
  isNameTaken(name: string): boolean;
  listAgents(): AgentRecord[];
  renameAgent(id: string, name: string): AgentRecord;
  updateAgent(id: string, change: AgentChange): AgentRecord;
  createDepartment(department: NewDepartment): DepartmentRecord;
  getDepartment(id: string): DepartmentRecord | undefined;
  // By name.
  listDepartments(): DepartmentRecord[];
  updateDepartment(id: string, settings: DepartmentSettings): DepartmentRecord;
  // Its lead and its workers, in the order they joined.
  listMembers(departmentId: string): AgentRecord[];
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
  constructor(
    kind:
      | "task"
      | "session"
      | "result"
      | "workspace"
      | "agent"
      | "profile"
      | "department"
      | "delegation",
    id: string,
  ) {
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

export class InUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InUseError";
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
