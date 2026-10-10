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
  PlanPiece,
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

// An agent's fields that can change; one left out is cleared, except its colour, which stays.
export interface AgentChange {
  colour?: AgentColour;
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

// A chief's task has a lead only; a team's task also has its department or the team to propose.
export type TaskTeam =
  | { leadAgentId: string; departmentId: string }
  | { leadAgentId: string; setup: TeamSetup }
  | { leadAgentId: string };

// A piece of a chief's plan names the chief's task.
export interface TaskPlacement {
  parentTaskId?: string;
  queued?: true;
}

export type NewPiece = Pick<PlanPiece, "taskId" | "key" | "title" | "brief" | "waitsOn"> &
  ({ departmentId: string } | { newDepartment: NonNullable<PlanPiece["newDepartment"]> });

// Fields left out keep their value; a piece that ends gets its end time.
export type PieceChange = Partial<
  Pick<PlanPiece, "status" | "departmentId" | "pieceTaskId" | "result">
>;

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

export type TurnOutcome = Extract<SessionEvent, { type: "turn.ended" }>["payload"]["outcome"];

export interface LatestTurn {
  ended: boolean;
  at: string;
  outcome?: TurnOutcome;
}

export type ChangeListener = (change: Change) => void;

export type LineDirection = "in" | "out";

// Synchronous on purpose: an in-process SQLite write takes microseconds (D-15).
export interface Store {
  // Hears every record change after its write, in write order.
  subscribe(listener: ChangeListener): () => void;
  createTask(prompt: string, team?: TaskTeam, placement?: TaskPlacement): TaskRecord;
  taskSetup(taskId: string): TeamSetup | undefined;
  joinDepartment(taskId: string, departmentId: string): TaskRecord;
  // A department works on one goal at a time.
  activeTaskOf(departmentId: string): string | undefined;
  // The chief runs one goal at a time.
  openTaskOfLead(agentId: string): string | undefined;
  oldestQueuedTask(): string | undefined;
  // Leaving "ended" clears the review.
  setTaskState(taskId: string, state: TaskState): void;
  markReviewed(taskId: string): TaskRecord;
  getTask(id: string): TaskRecord | undefined;
  // Newest first.
  listTasks(query: TaskQuery): TaskPage;
  listActiveTasks(): TaskSummary[];
  // An agent that worked on no other task is deleted with it.
  deleteTask(id: string): Promise<void>;
  createSession(session: NewSession): SessionRecord;
  getSession(id: string): SessionRecord | undefined;
  listSessions(taskId: string): SessionRecord[];
  // Across all the agent's tasks, newest first.
  listAgentSessions(agentId: string, query: AgentSessionQuery): SessionPage;
  latestTurn(sessionId: string): LatestTurn | undefined;
  // A prompt or core answer was stored after the latest turn started.
  owesTurn(sessionId: string): boolean;
  // A subagent's messages do not count.
  lastMessage(sessionId: string): string | undefined;
  // Run at startup; the sessions' delegations are cut off too.
  markInterrupted(): SessionRecord[];
  createDelegation(delegation: NewDelegation): DelegationRecord;
  listDelegations(taskId: string): DelegationRecord[];
  workingDelegation(workerSessionId: string): DelegationRecord | undefined;
  endDelegation(id: string, status: DelegationEnd, result?: string): void;
  createPiece(piece: NewPiece): PlanPiece;
  getPiece(id: string): PlanPiece | undefined;
  // Oldest first.
  listPieces(taskId: string): PlanPiece[];
  pieceOfTask(pieceTaskId: string): PlanPiece | undefined;
  // Waiting, queued or working, across all chief tasks, oldest first.
  listOpenPieces(): PlanPiece[];
  updatePiece(id: string, change: PieceChange): PlanPiece;
  // Nothing is returned for a text fragment, which is never stored.
  append(event: SessionEvent): StoredEvent | undefined;
  // Lines over 64 KiB are cut: the events already hold the text.
  appendHarnessLine(sessionId: string, direction: LineDirection, line: string): void;
  readEvents(query: EventQuery): StoredEvent[];
  listLimits(): HarnessLimits[];
  readOverflow(sessionId: string, sequence: number): string;
  listPendingRequests(): PendingRequestList;
  createAgent(agent: NewAgentRecord): AgentRecord;
  getAgent(id: string): AgentRecord | undefined;
  isNameTaken(name: string): boolean;
  listAgents(): AgentRecord[];
  renameAgent(id: string, name: string): AgentRecord;
  updateAgent(id: string, change: AgentChange): AgentRecord;
  createDepartment(department: NewDepartment): DepartmentRecord;
  getDepartment(id: string): DepartmentRecord | undefined;
  listDepartments(): DepartmentRecord[];
  updateDepartment(id: string, settings: DepartmentSettings): DepartmentRecord;
  // Lead first, then workers in join order.
  listMembers(departmentId: string): AgentRecord[];
  createProfile(profile: ProfileRequest): ProfileRecord;
  getProfile(id: string): ProfileRecord | undefined;
  listProfiles(): ProfileRecord[];
  updateProfile(id: string, profile: ProfileRequest): ProfileRecord;
  // Agents made from it keep the settings it had when they were made.
  deleteProfile(id: string): void;
  createWorkspace(workspace: WorkspaceRequest): WorkspaceRecord;
  getWorkspace(id: string): WorkspaceRecord | undefined;
  // Most recently used first.
  listWorkspaces(): WorkspaceRecord[];
  updateWorkspace(id: string, workspace: WorkspaceRequest): WorkspaceRecord;
  deleteWorkspace(id: string): void;
  // Moves it to the top of the list.
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
      | "delegation"
      | "piece",
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
