import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  type Account,
  type AccountLimits,
  type AgentRecord,
  type AgentSettings,
  type Attachment,
  type Audience,
  type Change,
  type CheckItem,
  type CheckRecord,
  type CheckResult,
  type ConnectorActivity,
  type ConnectorActivityQuery,
  type ConnectorCall,
  type ConnectorCallOutcome,
  type ConnectorPermission,
  type ConnectorRecord,
  type ConnectorSetup,
  type ConnectorStatus,
  type DelegationRecord,
  type DepartmentRecord,
  type DepartmentSettings,
  type EnvironmentSpec,
  type LibraryAudience,
  type LibraryItem,
  type LibraryItemChange,
  type ModelUsage,
  type OutputRecord,
  type OutputTarget,
  type OutputVersion,
  type PendingRequestList,
  type PlanPiece,
  type ProfileRecord,
  type ProfileRequest,
  type SessionEvent,
  type SessionOptions,
  type SessionPage,
  type SessionRecord,
  type SessionStatus,
  type Settings,
  type StoreSize,
  settingsSchema,
  type TaskChecklist,
  type TaskPage,
  type TaskPause,
  type TaskRecord,
  type TaskState,
  type TaskSummary,
  type TaskUsage,
  type TokenUsage,
  type UsageLimit,
  type UserRequestEvent,
  type WorkspaceFolder,
  type WorkspaceKind,
  type WorkspaceRecord,
  type WorkspaceRequest,
} from "@office-town/contract";
import { AttachmentFiles } from "./attachment-files.ts";
import { openDatabase, readNumber, transaction } from "./database.ts";
import { queries } from "./queries.ts";
import { fileSize, previewOutput, ResultFiles, utf8Prefix } from "./result-files.ts";
import {
  type AgentChange,
  type AgentSessionQuery,
  type ChangeListener,
  type CheckChange,
  type CheckSandbox,
  type ConnectorTool,
  type ConnectorUpdate,
  type DelegationEnd,
  type EventQuery,
  InUseError,
  type LatestTurn,
  type LineDirection,
  NameTakenError,
  type NewAgentRecord,
  type NewCheck,
  type NewConnector,
  type NewConnectorCall,
  type NewDelegation,
  type NewDepartment,
  type NewFile,
  type NewLibraryItem,
  type NewPiece,
  type NewSession,
  type PieceChange,
  RecordNotFoundError,
  type ShownOutput,
  type Store,
  type StoredEvent,
  TaskActiveError,
  type TaskPlacement,
  type TaskQuery,
  type TaskTeam,
  type TeamSetup,
  type TurnOutcome,
  type UnopenedItem,
  type WorkspaceActivity,
} from "./store.ts";

// Deleting in chunks lets live updates through; one statement blocks for most of a second.
const DELETE_CHUNK = 1000;
const VACUUM_STEP_PAGES = 500;
const LINE_CAP_BYTES = 64 * 1024;

interface TaskRow {
  ref: number;
  id: string;
  prompt: string;
  createdAt: number;
  leadAgentId: string | null;
  departmentId: string | null;
  parentTaskId: string | null;
  workspaceId: string | null;
  setup: string | null;
  state: TaskState;
  reviewedAt: number | null;
  paused: string | null;
  checklist: string | null;
  // A JSON list of agent ids.
  workerAgentIds: string;
}

interface SessionRow {
  ref: number;
  id: string;
  taskId: string;
  agentId: string;
  options: string;
  status: SessionStatus;
  createdAt: number;
  harnessSessionId: string | null;
  resumedFrom: string | null;
  endedAt: number | null;
}

interface EventRow {
  position: number;
  sessionId: string;
  sequence: number;
  id: string;
  type: SessionEvent["type"];
  timestamp: number;
  payload: string;
}

interface AgentRow {
  ref: number;
  id: string;
  name: string;
  colour: AgentRecord["colour"];
  role: string | null;
  purpose: string | null;
  departmentId: string | null;
  autonomy: AgentRecord["autonomy"] | null;
  guest: number;
  profileId: string | null;
  settings: string;
  createdAt: number;
}

interface DepartmentRow {
  ref: number;
  id: string;
  name: string;
  workspaceId: string;
  moreWorkspaceIds: string;
  autonomy: DepartmentRecord["autonomy"];
  leadAgentId: string;
  branchPerWorker: number;
  codeFlow: number;
  rules: string | null;
  purpose: string | null;
  removedAt: number | null;
  createdAt: number;
}

interface DelegationRow {
  ref: number;
  id: string;
  taskId: string;
  workerAgentId: string;
  workerSessionId: string;
  brief: string;
  status: DelegationRecord["status"];
  result: string | null;
  createdAt: number;
  endedAt: number | null;
}

interface CheckRow {
  ref: number;
  id: string;
  taskId: string;
  round: number;
  status: CheckRecord["status"];
  checkerAgentId: string;
  checkerSessionId: string;
  ownerAgentId: string;
  sandboxKind: CheckRecord["sandbox"];
  // JSON.
  items: string;
  results: string | null;
  notes: string | null;
  createdAt: number;
  endedAt: number | null;
}

interface PieceRow {
  ref: number;
  id: string;
  taskId: string;
  key: string;
  title: string;
  departmentId: string | null;
  workspaceId: string | null;
  newDepartment: string | null;
  brief: string;
  waitsOn: string;
  status: PlanPiece["status"];
  pieceTaskId: string | null;
  result: string | null;
  createdAt: number;
  endedAt: number | null;
}

interface AccountRow {
  id: string;
  harness: string;
  environment: string;
  name: string;
  folder: string;
  createdAt: number;
}

interface ProfileRow {
  ref: number;
  id: string;
  name: string;
  role: string;
  colour: ProfileRecord["colour"];
  settings: string;
  createdAt: number;
}

interface WorkspaceRow {
  ref: number;
  id: string;
  name: string;
  kind: WorkspaceKind;
  folders: string;
  createdAt: number;
  usedAt: number;
}

interface AttachmentRow {
  ref: number;
  id: string;
  kind: Attachment["kind"];
  name: string;
  path: string;
  bytes: number | null;
  mimeType: string | null;
  sha256: string | null;
  createdAt: number;
}

type AttachmentRef = Pick<AttachmentRow, "ref" | "id" | "kind">;

interface ConnectorRow {
  ref: number;
  id: string;
  setup: string;
  audience: string;
  permission: ConnectorPermission;
  enabled: number;
  status: ConnectorStatus;
  createdAt: number;
}

interface ConnectorCallRow {
  position: number;
  id: string;
  connectorId: string;
  agentId: string;
  taskId: string;
  departmentId: string | null;
  tool: string;
  input: string;
  change: number;
  outcome: ConnectorCallOutcome;
  at: number;
}

interface LibraryRow {
  ref: number;
  id: string;
  workspaceId: string;
  givenTo: string;
  addedByAgentId: string | null;
  createdAt: number;
  fileRef: number;
  fileId: string;
  kind: Attachment["kind"];
  name: string;
  path: string;
  bytes: number | null;
  mimeType: string | null;
  sha256: string | null;
  fileCreatedAt: number;
  givenIn: number;
  openedIn: number;
}

type Statements = Record<keyof typeof queries, StatementSync>;

const SETTING_KEYS = Object.keys(settingsSchema.shape) as (keyof Settings)[];

// SQLite rows come back loosely typed; these name the shape the query selects.
function one<T>(statement: StatementSync, ...params: SQLInputValue[]): T | undefined {
  return statement.get(...params) as T | undefined;
}

function all<T>(statement: StatementSync, ...params: SQLInputValue[]): T[] {
  return statement.all(...params) as T[];
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function workersOf(row: TaskRow): Pick<TaskRecord, "workerAgentIds"> {
  const workerAgentIds = JSON.parse(row.workerAgentIds) as string[];
  return workerAgentIds.length === 0 ? {} : { workerAgentIds };
}

function toTask(row: TaskRow, usage: TaskUsage[]): TaskRecord {
  return {
    id: row.id,
    prompt: row.prompt,
    createdAt: iso(row.createdAt),
    ...(row.leadAgentId === null ? {} : { leadAgentId: row.leadAgentId }),
    ...(row.departmentId === null ? {} : { departmentId: row.departmentId }),
    ...workersOf(row),
    ...(row.parentTaskId === null ? {} : { parentTaskId: row.parentTaskId }),
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
    state: row.state,
    ...(row.reviewedAt === null ? {} : { reviewedAt: iso(row.reviewedAt) }),
    ...(row.paused === null ? {} : { paused: JSON.parse(row.paused) as TaskPause }),
    ...(row.checklist === null ? {} : { checklist: JSON.parse(row.checklist) as TaskChecklist }),
    usage,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    options: JSON.parse(row.options) as SessionOptions,
    status: row.status,
    createdAt: iso(row.createdAt),
    ...(row.harnessSessionId === null ? {} : { harnessSessionId: row.harnessSessionId }),
    ...(row.resumedFrom === null ? {} : { resumedFrom: row.resumedFrom }),
    ...(row.endedAt === null ? {} : { endedAt: iso(row.endedAt) }),
  };
}

function toAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.purpose === null ? {} : { purpose: row.purpose }),
    ...(row.departmentId === null ? {} : { departmentId: row.departmentId }),
    ...(row.autonomy === null ? {} : { autonomy: row.autonomy }),
    ...(row.guest === 1 ? { guest: true as const } : {}),
    ...(row.profileId === null ? {} : { profileId: row.profileId }),
    settings: JSON.parse(row.settings) as AgentSettings,
    createdAt: iso(row.createdAt),
  };
}

function toDepartment(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspaceId,
    workspaceIds: [
      row.workspaceId,
      ...(JSON.parse(row.moreWorkspaceIds) as [number, string][])
        .sort(([a], [b]) => a - b)
        .map(([, id]) => id),
    ],
    autonomy: row.autonomy,
    leadAgentId: row.leadAgentId,
    branchPerWorker: row.branchPerWorker === 1,
    codeFlow: row.codeFlow === 1,
    ...(row.rules === null ? {} : { rules: row.rules }),
    ...(row.purpose === null ? {} : { purpose: row.purpose }),
    createdAt: iso(row.createdAt),
  };
}

const textOrNull = (text: string | undefined) => (text?.trim() ? text.trim() : null);

function toDelegation(row: DelegationRow): DelegationRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    workerAgentId: row.workerAgentId,
    workerSessionId: row.workerSessionId,
    brief: row.brief,
    status: row.status,
    ...(row.result === null ? {} : { result: row.result }),
    createdAt: iso(row.createdAt),
    ...(row.endedAt === null ? {} : { endedAt: iso(row.endedAt) }),
  };
}

interface OutputRow {
  ref: number;
  id: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  title: string;
  kind: OutputTarget["kind"];
  // A path or an address, by kind.
  target: string;
  // JSON.
  versions: string;
  picturedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function toOutput(row: OutputRow): OutputRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    sessionId: row.sessionId,
    title: row.title,
    target:
      row.kind === "file" ? { kind: "file", path: row.target } : { kind: "site", url: row.target },
    versions: JSON.parse(row.versions) as OutputVersion[],
    ...(row.picturedAt === null ? {} : { picturedAt: iso(row.picturedAt) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

const targetText = (target: OutputTarget) => (target.kind === "file" ? target.path : target.url);

// Results listed with no task, such as on the Office's panels.
const LATEST_OUTPUTS = 500;

function toCheck(row: CheckRow): CheckRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    round: row.round,
    status: row.status,
    checkerAgentId: row.checkerAgentId,
    checkerSessionId: row.checkerSessionId,
    ownerAgentId: row.ownerAgentId,
    sandbox: row.sandboxKind,
    items: JSON.parse(row.items) as CheckItem[],
    ...(row.results === null ? {} : { results: JSON.parse(row.results) as CheckResult[] }),
    ...(row.notes === null ? {} : { notes: JSON.parse(row.notes) as string[] }),
    createdAt: iso(row.createdAt),
    ...(row.endedAt === null ? {} : { endedAt: iso(row.endedAt) }),
  };
}

const ENDED_CHECK = new Set<CheckRecord["status"]>(["done", "stopped", "failed"]);

function toPiece(row: PieceRow): PlanPiece {
  return {
    id: row.id,
    taskId: row.taskId,
    key: row.key,
    title: row.title,
    ...(row.departmentId === null ? {} : { departmentId: row.departmentId }),
    ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
    ...(row.newDepartment === null
      ? {}
      : { newDepartment: JSON.parse(row.newDepartment) as PlanPiece["newDepartment"] }),
    brief: row.brief,
    waitsOn: JSON.parse(row.waitsOn) as string[],
    status: row.status,
    ...(row.pieceTaskId === null ? {} : { pieceTaskId: row.pieceTaskId }),
    ...(row.result === null ? {} : { result: row.result }),
    createdAt: iso(row.createdAt),
    ...(row.endedAt === null ? {} : { endedAt: iso(row.endedAt) }),
  };
}

const OPEN_PIECE = new Set<PlanPiece["status"]>(["waiting", "queued", "working"]);

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    harness: row.harness,
    environment: JSON.parse(row.environment) as EnvironmentSpec,
    name: row.name,
    folder: row.folder,
    createdAt: iso(row.createdAt),
  };
}

function toProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    colour: row.colour,
    settings: JSON.parse(row.settings) as AgentSettings,
    createdAt: iso(row.createdAt),
  };
}

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

function isUniqueViolation(error: unknown): boolean {
  return (error as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    path: row.path,
    ...(row.bytes === null ? {} : { bytes: row.bytes }),
    ...(row.mimeType === null ? {} : { mimeType: row.mimeType }),
    ...(row.sha256 === null ? {} : { sha256: row.sha256 }),
    createdAt: iso(row.createdAt),
  };
}

function toConnector(row: ConnectorRow): ConnectorRecord {
  return {
    id: row.id,
    setup: JSON.parse(row.setup) as ConnectorSetup,
    audience: JSON.parse(row.audience) as Audience,
    permission: row.permission,
    enabled: row.enabled === 1,
    status: row.status,
    createdAt: iso(row.createdAt),
  };
}

function toConnectorCall(row: ConnectorCallRow): ConnectorCall {
  return {
    id: row.id,
    position: row.position,
    connectorId: row.connectorId,
    agentId: row.agentId,
    taskId: row.taskId,
    ...(row.departmentId === null ? {} : { departmentId: row.departmentId }),
    tool: row.tool,
    input: JSON.parse(row.input) as unknown,
    change: row.change === 1,
    outcome: row.outcome,
    at: iso(row.at),
  };
}

const CONNECTOR_PAGE = 50;
// The input is kept to describe the call, not to replay it.
const CALL_INPUT_CHARS = 2000;

function inputText(input: unknown): string {
  const text = JSON.stringify(input ?? {});
  return text.length <= CALL_INPUT_CHARS ? text : JSON.stringify({ truncated: true });
}

function toLibraryItem(row: LibraryRow): LibraryItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    file: toAttachment({ ...row, ref: row.fileRef, id: row.fileId, createdAt: row.fileCreatedAt }),
    givenTo: JSON.parse(row.givenTo) as LibraryAudience,
    ...(row.addedByAgentId === null ? {} : { addedByAgentId: row.addedByAgentId }),
    createdAt: iso(row.createdAt),
    givenIn: row.givenIn,
    openedIn: row.openedIn,
  };
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    folders: JSON.parse(row.folders) as WorkspaceFolder[],
    createdAt: iso(row.createdAt),
    usedAt: iso(row.usedAt),
  };
}

function toStoredEvent(row: EventRow): StoredEvent {
  const event = {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    timestamp: iso(row.timestamp),
    type: row.type,
    payload: JSON.parse(row.payload),
  } as SessionEvent;
  return { position: row.position, event };
}

export function openStore(directory: string): Store {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "store.db");
  return new SqliteStore(
    openDatabase(file),
    file,
    new ResultFiles(join(directory, "results")),
    new AttachmentFiles(join(directory, "files")),
    join(directory, "outputs"),
  );
}

class SqliteStore implements Store {
  readonly #db: DatabaseSync;
  readonly #file: string;
  readonly #results: ResultFiles;
  readonly #files: AttachmentFiles;
  // Kept versions and pictures of results, one folder per result.
  readonly #outputs: string;
  readonly #statements: Statements;
  // While a task's rows are deleted in chunks, no new session may join it.
  readonly #deleting = new Set<string>();
  readonly #listeners = new Set<ChangeListener>();
  readonly #outbox: Change[] = [];
  #publishing = false;

  constructor(
    db: DatabaseSync,
    file: string,
    results: ResultFiles,
    files: AttachmentFiles,
    outputs: string,
  ) {
    this.#db = db;
    this.#file = file;
    this.#results = results;
    this.#files = files;
    this.#outputs = outputs;
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Statements;
  }

  subscribe(listener: ChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  createTask(prompt: string, team?: TaskTeam, placement: TaskPlacement = {}): TaskRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    const lead = team === undefined ? undefined : this.#agentRow(team.leadAgentId);
    const department =
      team !== undefined && "departmentId" in team
        ? this.#departmentRow(team.departmentId)
        : undefined;
    const setup = team !== undefined && "setup" in team ? JSON.stringify(team.setup) : null;
    const parent =
      placement.parentTaskId === undefined ? undefined : this.#taskRow(placement.parentTaskId);
    const workspace =
      placement.workspaceId === undefined ? undefined : this.#workspaceRow(placement.workspaceId);
    const workers =
      team !== undefined && "workerAgentIds" in team
        ? team.workerAgentIds.map((agentId) => this.#agentRow(agentId))
        : [];
    transaction(this.#db, () => {
      const { lastInsertRowid } = this.#statements.insertTask.run(
        id,
        prompt,
        createdAt,
        lead?.ref ?? null,
        department?.ref ?? null,
        setup,
        placement.queued ? "queued" : "working",
        parent?.ref ?? null,
        workspace?.ref ?? null,
      );
      for (const worker of workers) {
        this.#statements.insertTaskWorker.run(lastInsertRowid, worker.ref);
      }
    });
    return this.#publishTask(id);
  }

  taskSetup(taskId: string): TeamSetup | undefined {
    const { setup } = this.#taskRow(taskId);
    return setup === null ? undefined : (JSON.parse(setup) as TeamSetup);
  }

  joinDepartment(taskId: string, departmentId: string): TaskRecord {
    const task = this.#taskRow(taskId);
    this.#statements.taskJoinsDepartment.run(this.#departmentRow(departmentId).ref, task.ref);
    return this.#publishTask(taskId);
  }

  activeTaskOf(departmentId: string): string | undefined {
    const ref = this.#departmentRow(departmentId).ref;
    return one<{ id: string }>(this.#statements.activeTaskOfDepartment, ref)?.id;
  }

  openTaskOfLead(agentId: string): string | undefined {
    const ref = this.#agentRow(agentId).ref;
    return one<{ id: string }>(this.#statements.openTaskOfLead, ref)?.id;
  }

  unendedTaskOfLead(agentId: string): string | undefined {
    const ref = this.#agentRow(agentId).ref;
    return one<{ id: string }>(this.#statements.unendedTaskOfLead, ref)?.id;
  }

  oldestQueuedTask(): string | undefined {
    return one<{ id: string }>(this.#statements.oldestQueuedTask)?.id;
  }

  setTaskState(taskId: string, state: TaskState): void {
    const { ref } = this.#taskRow(taskId);
    if (this.#statements.setTaskState.run(state, ref).changes > 0) this.#publishTask(taskId);
  }

  setTaskPause(taskId: string, pause: TaskPause | undefined): TaskRecord {
    const value = pause === undefined ? null : JSON.stringify(pause);
    this.#statements.setTaskPause.run(value, this.#taskRow(taskId).ref);
    return this.#publishTask(taskId);
  }

  setTaskChecklist(taskId: string, checklist: TaskChecklist): TaskRecord {
    this.#statements.setTaskChecklist.run(JSON.stringify(checklist), this.#taskRow(taskId).ref);
    return this.#publishTask(taskId);
  }

  markReviewed(taskId: string): TaskRecord {
    this.#statements.taskReviewed.run(Date.now(), this.#taskRow(taskId).ref);
    return this.#publishTask(taskId);
  }

  getTask(id: string): TaskRecord | undefined {
    const row = one<TaskRow>(this.#statements.taskById, id);
    return row === undefined ? undefined : this.#toTask(row);
  }

  listTasks({ limit, cursor }: TaskQuery): TaskPage {
    // The cursor is the last task's key, so it stays valid after that task is deleted.
    const before = cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(cursor);
    const rows = all<TaskRow>(this.#statements.tasksBefore, before, limit);
    const last = rows.at(-1);
    const tasks = rows.map((row) => this.#summarize(row));
    return rows.length < limit || last === undefined
      ? { tasks }
      : { tasks, next: String(last.ref) };
  }

  listActiveTasks(): TaskSummary[] {
    const sessions = all<SessionRow>(this.#statements.unfinishedSessions);
    return [...new Set(sessions.map((session) => session.taskId))]
      .map((id) => this.#taskRow(id))
      .sort((a, b) => b.ref - a.ref)
      .map((row) => this.#summarize(row));
  }

  listPausedTasks(): TaskSummary[] {
    return all<{ id: string }>(this.#statements.pausedTasks).map(({ id }) =>
      this.#summarize(this.#taskRow(id)),
    );
  }

  async deleteTask(id: string): Promise<void> {
    const task = this.#taskRow(id);
    if (one(this.#statements.unfinishedInTask, task.ref) !== undefined) {
      throw new TaskActiveError(id);
    }
    this.#deleting.add(id);
    try {
      const sessions = all<SessionRow>(this.#statements.sessionsOfTask, task.ref);
      const agents = all<{ ref: number }>(this.#statements.agentsOfTask, task.ref);
      for (const session of sessions) {
        await this.#deleteInChunks(this.#statements.deleteSessionEvents, session.ref);
        await this.#deleteInChunks(this.#statements.deleteSessionHarnessLines, session.ref);
      }
      // Deleting a chief's goal clears its pieces' link to it, so they are published again.
      const children = all<{ id: string }>(this.#statements.childTasks, task.ref);
      const attachments = all<AttachmentRef>(this.#statements.attachmentsOnlyOfTask, task.ref);
      const outputs = all<{ id: string }>(this.#statements.outputIdsOfTask, task.ref);
      transaction(this.#db, () => {
        this.#statements.deleteTask.run(task.ref);
        for (const attachment of attachments) {
          this.#statements.deleteAttachment.run(attachment.ref);
        }
        for (const ref of new Set(agents.map((agent) => agent.ref))) {
          this.#statements.deleteAgentIfUnused.run(ref);
        }
      });
      // Agents deleted with the task worked on nothing else, so the task's notice covers them.
      this.#publish({ type: "task.deleted", taskId: id });
      for (const child of children) this.#publishTask(child.id);
      await Promise.all(sessions.map((session) => this.#results.remove(session.id)));
      await this.#removeCopies(attachments);
      await Promise.all(
        outputs.map(({ id: outputId }) =>
          rm(join(this.#outputs, outputId), { recursive: true, force: true }),
        ),
      );
      await this.#returnFreeSpace();
    } finally {
      this.#deleting.delete(id);
    }
  }

  createSession({ id, taskId, agentId, options, resumedFrom }: NewSession): SessionRecord {
    if (this.#deleting.has(taskId)) throw new RecordNotFoundError("task", taskId);
    const taskRef = this.#taskRow(taskId).ref;
    const agentRef = this.#agentRow(agentId).ref;
    const resumedFromRef = resumedFrom === undefined ? null : this.#sessionRef(resumedFrom);
    const createdAt = Date.now();
    this.#statements.insertSession.run(
      id,
      taskRef,
      agentRef,
      resumedFromRef,
      JSON.stringify(options),
      createdAt,
    );
    return {
      id,
      taskId,
      agentId,
      options,
      status: "starting",
      createdAt: iso(createdAt),
      ...(resumedFrom === undefined ? {} : { resumedFrom }),
    };
  }

  updateSessionOptions(id: string, options: SessionOptions): SessionRecord {
    this.#statements.updateSessionOptions.run(JSON.stringify(options), id);
    const session = this.getSession(id);
    if (session === undefined) throw new RecordNotFoundError("session", id);
    return session;
  }

  getSession(id: string): SessionRecord | undefined {
    const row = one<SessionRow>(this.#statements.sessionById, id);
    return row === undefined ? undefined : toSession(row);
  }

  listSessions(taskId: string): SessionRecord[] {
    return all<SessionRow>(this.#statements.sessionsOfTask, this.#taskRow(taskId).ref).map(
      toSession,
    );
  }

  listAgentSessions(agentId: string, { limit, before }: AgentSessionQuery): SessionPage {
    const agentRef = this.#agentRow(agentId).ref;
    // The cursor is the last session's key, so it stays valid after that session's task is deleted.
    const beforeRef = before === undefined ? Number.MAX_SAFE_INTEGER : Number(before);
    const rows = all<SessionRow>(this.#statements.agentSessionsBefore, agentRef, beforeRef, limit);
    const last = rows.at(-1);
    const sessions = rows.map(toSession);
    return rows.length < limit || last === undefined
      ? { sessions }
      : { sessions, next: String(last.ref) };
  }

  latestTurn(sessionId: string): LatestTurn | undefined {
    const row = one<{ type: string; timestamp: number; outcome: TurnOutcome | null }>(
      this.#statements.latestTurnOfSession,
      this.#sessionRef(sessionId),
    );
    if (row === undefined) return undefined;
    const turn = { ended: row.type === "turn.ended", at: iso(row.timestamp) };
    return row.outcome === null ? turn : { ...turn, outcome: row.outcome };
  }

  owesTurn(sessionId: string): boolean {
    return one(this.#statements.promptAfterTurn, this.#sessionRef(sessionId)) !== undefined;
  }

  lastMessage(sessionId: string): string | undefined {
    const ref = this.#sessionRef(sessionId);
    return one<{ text: string }>(this.#statements.lastAgentMessage, ref)?.text;
  }

  markInterrupted(): SessionRecord[] {
    const { sessions, delegations } = transaction(this.#db, () => {
      const sessions = all<SessionRow>(this.#statements.unfinishedSessions);
      const delegations = all<DelegationRow>(this.#statements.workingDelegations);
      this.#statements.deleteUnfinishedPendingRequests.run();
      this.#statements.interruptUnfinished.run();
      this.#statements.interruptDelegations.run();
      return { sessions, delegations };
    });
    for (const row of delegations) {
      this.#publish({
        type: "delegation",
        delegation: toDelegation({ ...row, status: "interrupted" }),
      });
    }
    // The tasks' records are unchanged, but whoever keeps their state reads them again.
    for (const taskId of new Set(sessions.map((row) => row.taskId))) this.#publishTask(taskId);
    return sessions.map((row) => ({ ...toSession(row), status: "interrupted" as const }));
  }

  // Like a restart, for these sessions only.
  interruptSessions(sessionIds: string[]): void {
    const { taskIds, delegations } = transaction(this.#db, () => {
      const taskIds = new Set<string>();
      const delegations: DelegationRow[] = [];
      for (const id of sessionIds) {
        const session = this.getSession(id);
        if (session === undefined) continue;
        taskIds.add(session.taskId);
        delegations.push(...all<DelegationRow>(this.#statements.workingDelegationsOfSession, id));
        this.#statements.deleteSessionPendingRequests.run(this.#sessionRef(id));
        this.#statements.interruptSession.run(id);
        this.#statements.interruptDelegationsOfSession.run(id);
      }
      return { taskIds, delegations };
    });
    for (const row of delegations) {
      this.#publish({
        type: "delegation",
        delegation: toDelegation({ ...row, status: "interrupted" }),
      });
    }
    for (const taskId of taskIds) this.#publishTask(taskId);
  }

  createDelegation(delegation: NewDelegation): DelegationRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.#statements.insertDelegation.run(
      id,
      this.#taskRow(delegation.taskId).ref,
      this.#agentRow(delegation.workerAgentId).ref,
      delegation.workerSessionId,
      delegation.brief,
      createdAt,
    );
    const record = { ...delegation, id, status: "working" as const, createdAt: iso(createdAt) };
    this.#publish({ type: "delegation", delegation: record });
    return record;
  }

  listDelegations(taskId: string): DelegationRecord[] {
    const ref = this.#taskRow(taskId).ref;
    return all<DelegationRow>(this.#statements.delegationsOfTask, ref).map(toDelegation);
  }

  workingDelegation(workerSessionId: string): DelegationRecord | undefined {
    const row = one<DelegationRow>(this.#statements.workingDelegationOf, workerSessionId);
    return row === undefined ? undefined : toDelegation(row);
  }

  endDelegation(id: string, status: DelegationEnd, result?: string): void {
    const row = this.#delegationRow(id);
    const endedAt = Date.now();
    this.#statements.endDelegation.run(status, result ?? null, endedAt, row.ref);
    const ended = { ...row, status, result: result ?? null, endedAt };
    this.#publish({ type: "delegation", delegation: toDelegation(ended) });
  }

  createCheck(check: NewCheck, sandbox: CheckSandbox): CheckRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.#statements.insertCheck.run(
      id,
      this.#taskRow(check.taskId).ref,
      check.round,
      check.status,
      this.#agentRow(check.checkerAgentId).ref,
      check.checkerSessionId,
      this.#agentRow(check.ownerAgentId).ref,
      JSON.stringify(check.items),
      check.sandbox,
      JSON.stringify(sandbox),
      createdAt,
    );
    const record = { ...check, id, createdAt: iso(createdAt) };
    this.#publish({ type: "check", check: record });
    return record;
  }

  getCheck(id: string): CheckRecord | undefined {
    const row = one<CheckRow>(this.#statements.checkById, id);
    return row === undefined ? undefined : toCheck(row);
  }

  listChecks(taskId: string): CheckRecord[] {
    const ref = this.#taskRow(taskId).ref;
    return all<CheckRow>(this.#statements.checksOfTask, ref).map(toCheck);
  }

  checkOfSession(checkerSessionId: string): CheckRecord | undefined {
    const row = one<CheckRow>(this.#statements.checkOfSession, checkerSessionId);
    return row === undefined ? undefined : toCheck(row);
  }

  updateCheck(id: string, change: CheckChange): CheckRecord {
    const row = one<CheckRow>(this.#statements.checkById, id);
    if (row === undefined) throw new RecordNotFoundError("check", id);
    const next = { ...toCheck(row), ...change };
    const ended = ENDED_CHECK.has(next.status);
    const endedAt = row.endedAt ?? (ended ? Date.now() : null);
    this.#statements.updateCheck.run(
      next.status,
      JSON.stringify(next.items),
      next.results === undefined ? null : JSON.stringify(next.results),
      next.notes === undefined ? null : JSON.stringify(next.notes),
      endedAt,
      row.ref,
    );
    const record = {
      ...next,
      ...(endedAt === null ? {} : { endedAt: iso(endedAt) }),
    };
    this.#publish({ type: "check", check: record });
    return record;
  }

  stopOpenChecks(): void {
    for (const row of all<CheckRow>(this.#statements.openChecks)) {
      this.updateCheck(row.id, { status: "stopped" });
    }
  }

  checkSandboxes(taskId?: string): { checkId: string; sandbox: CheckSandbox }[] {
    const rows =
      taskId === undefined
        ? all<{ id: string; sandbox: string }>(this.#statements.checkSandboxes)
        : all<{ id: string; sandbox: string }>(
            this.#statements.checkSandboxesOfTask,
            this.#taskRow(taskId).ref,
          );
    return rows.map(({ id, sandbox }) => ({
      checkId: id,
      sandbox: JSON.parse(sandbox) as CheckSandbox,
    }));
  }

  sandboxRemoved(checkId: string): void {
    this.#statements.clearCheckSandbox.run(checkId);
  }

  showOutput(output: ShownOutput): OutputRecord {
    const taskRef = this.#taskRow(output.taskId).ref;
    const agentRef = this.#agentRow(output.agentId).ref;
    const target = targetText(output.target);
    const now = Date.now();
    const version = (number: number): OutputVersion[] =>
      output.target.kind === "file" ? [{ number, at: iso(now), kept: output.kept }] : [];
    const row = one<OutputRow>(
      this.#statements.outputByTarget,
      taskRef,
      output.target.kind,
      target,
    );
    if (row === undefined) {
      this.#statements.insertOutput.run(
        randomUUID(),
        taskRef,
        agentRef,
        output.sessionId,
        output.title,
        output.target.kind,
        target,
        JSON.stringify(version(1)),
        now,
        now,
      );
    } else {
      const versions = JSON.parse(row.versions) as OutputVersion[];
      const next = [...versions, ...version((versions.at(-1)?.number ?? 0) + 1)];
      this.#statements.updateOutput.run(
        agentRef,
        output.sessionId,
        output.title,
        JSON.stringify(next),
        now,
        row.ref,
      );
    }
    const saved = one<OutputRow>(
      this.#statements.outputByTarget,
      taskRef,
      output.target.kind,
      target,
    );
    if (saved === undefined) throw new RecordNotFoundError("output", target);
    const record = toOutput(saved);
    this.#publish({ type: "output", output: record });
    return record;
  }

  getOutput(id: string): OutputRecord | undefined {
    const row = one<OutputRow>(this.#statements.outputById, id);
    return row === undefined ? undefined : toOutput(row);
  }

  listOutputs(taskId?: string): OutputRecord[] {
    const rows =
      taskId === undefined
        ? all<OutputRow>(this.#statements.latestOutputs, LATEST_OUTPUTS)
        : all<OutputRow>(this.#statements.outputsOfTask, this.#taskRow(taskId).ref);
    return rows.map(toOutput);
  }

  outputPictured(id: string): OutputRecord {
    const row = one<OutputRow>(this.#statements.outputById, id);
    if (row === undefined) throw new RecordNotFoundError("output", id);
    const picturedAt = Date.now();
    this.#statements.setOutputPicture.run(picturedAt, row.ref);
    const record = toOutput({ ...row, picturedAt });
    this.#publish({ type: "output", output: record });
    return record;
  }

  contextTokens(sessionId: string): number | undefined {
    const row = one<{ tokens: number | null }>(
      this.#statements.lastContextTokens,
      this.#sessionRef(sessionId),
    );
    return row?.tokens ?? undefined;
  }

  createPiece(piece: NewPiece): PlanPiece {
    const id = randomUUID();
    const department =
      "departmentId" in piece ? this.#departmentRow(piece.departmentId) : undefined;
    const workspaceId = "workspaceId" in piece ? piece.workspaceId : undefined;
    this.#statements.insertPiece.run(
      id,
      this.#taskRow(piece.taskId).ref,
      piece.key,
      piece.title,
      department?.ref ?? null,
      workspaceId === undefined ? null : this.#workspaceRow(workspaceId).ref,
      "newDepartment" in piece ? JSON.stringify(piece.newDepartment) : null,
      piece.brief,
      JSON.stringify(piece.waitsOn),
      Date.now(),
    );
    return this.#publishPiece(id);
  }

  getPiece(id: string): PlanPiece | undefined {
    const row = one<PieceRow>(this.#statements.pieceById, id);
    return row === undefined ? undefined : toPiece(row);
  }

  listPieces(taskId: string): PlanPiece[] {
    const ref = this.#taskRow(taskId).ref;
    return all<PieceRow>(this.#statements.piecesOfTask, ref).map(toPiece);
  }

  pieceOfTask(pieceTaskId: string): PlanPiece | undefined {
    const task = one<TaskRow>(this.#statements.taskById, pieceTaskId);
    if (task === undefined) return undefined;
    const row = one<PieceRow>(this.#statements.pieceOfPieceTask, task.ref);
    return row === undefined ? undefined : toPiece(row);
  }

  listOpenPieces(): PlanPiece[] {
    return all<PieceRow>(this.#statements.openPieces)
      .sort((a, b) => a.ref - b.ref)
      .map(toPiece);
  }

  updatePiece(id: string, change: PieceChange): PlanPiece {
    const row = this.#pieceRow(id);
    const status = change.status ?? row.status;
    const departmentId = change.departmentId ?? row.departmentId;
    const pieceTaskId = change.pieceTaskId ?? row.pieceTaskId;
    const endedAt = OPEN_PIECE.has(status) ? null : (row.endedAt ?? Date.now());
    this.#statements.updatePiece.run(
      status,
      departmentId === null ? null : this.#departmentRow(departmentId).ref,
      pieceTaskId === null ? null : this.#taskRow(pieceTaskId).ref,
      change.result ?? row.result,
      endedAt,
      row.ref,
    );
    return this.#publishPiece(id);
  }

  append(event: SessionEvent): StoredEvent | undefined {
    if (event.type === "message.delta" || event.type === "reasoning.delta") return undefined;
    const sessionRef = this.#sessionRef(event.sessionId);
    // A file is written before its row; if the row then fails, the file is removed with its session.
    const stored = this.#keepLargeTextApart(event);
    const { position, change } = transaction(this.#db, () => {
      const { lastInsertRowid } = this.#statements.insertEvent.run(
        sessionRef,
        stored.sequence,
        stored.id,
        stored.type,
        Date.parse(stored.timestamp),
        JSON.stringify(stored.payload),
      );
      const position = Number(lastInsertRowid);
      this.#updateSession(sessionRef, stored);
      this.#updatePendingRequests(sessionRef, position, stored);
      return { position, change: this.#updateUsage(sessionRef, stored) };
    });
    if (change !== undefined) this.#publish(change);
    return { position, event: stored };
  }

  appendHarnessLine(sessionId: string, direction: LineDirection, line: string): void {
    const bytes = Buffer.byteLength(line);
    const cut = bytes > LINE_CAP_BYTES;
    this.#statements.insertHarnessLine.run(
      this.#sessionRef(sessionId),
      direction,
      cut ? utf8Prefix(Buffer.from(line), LINE_CAP_BYTES) : line,
      cut ? bytes : null,
      Date.now(),
    );
  }

  readEvents({ after, limit, sessionId }: EventQuery): StoredEvent[] {
    const rows =
      sessionId === undefined
        ? all<EventRow>(this.#statements.eventsAfter, after, limit)
        : all<EventRow>(
            this.#statements.sessionEventsAfter,
            this.#sessionRef(sessionId),
            after,
            limit,
          );
    return rows.map(toStoredEvent);
  }

  listLimits(): AccountLimits[] {
    return all<{ accountId: string; harness: string; limits: string; reportedAt: number }>(
      this.#statements.allLimits,
    ).map((row) => ({
      accountId: row.accountId,
      harness: row.harness,
      limits: JSON.parse(row.limits) as UsageLimit[],
      reportedAt: iso(row.reportedAt),
    }));
  }

  saveLimits(entry: AccountLimits): void {
    const { accountId, harness, limits, reportedAt } = entry;
    this.#statements.saveLimits.run(
      accountId,
      harness,
      JSON.stringify(limits),
      Date.parse(reportedAt),
    );
    this.#publish({ type: "limits", limits: entry });
  }

  readOverflow(sessionId: string, sequence: number): string {
    // An unknown session is reported as such, not as a missing file.
    this.#sessionRef(sessionId);
    const text = this.#results.read(sessionId, sequence);
    if (text === undefined) throw new RecordNotFoundError("result", `${sessionId}/${sequence}`);
    return text;
  }

  listPendingRequests(): PendingRequestList {
    const rows = all<EventRow & { taskId: string }>(this.#statements.pendingRequests);
    const last = one<{ position: number | null }>(this.#statements.lastPosition);
    return {
      requests: rows.map((row) => ({
        position: row.position,
        taskId: row.taskId,
        event: toStoredEvent(row).event as UserRequestEvent,
      })),
      position: last?.position ?? 0,
    };
  }

  createAgent(agent: NewAgentRecord): AgentRecord {
    const { name, colour, role, purpose, departmentId, autonomy, guest, profileId, settings } =
      agent;
    const id = randomUUID();
    const profileRef = profileId === undefined ? null : this.#profileRow(profileId).ref;
    const departmentRef = departmentId === undefined ? null : this.#departmentRow(departmentId).ref;
    const createdAt = Date.now();
    try {
      this.#statements.insertAgent.run(
        id,
        name,
        colour,
        role ?? null,
        purpose ?? null,
        departmentRef,
        autonomy ?? null,
        guest ? 1 : 0,
        profileRef,
        JSON.stringify(settings),
        createdAt,
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new NameTakenError(name);
      throw error;
    }
    return this.#publishAgent(id);
  }

  getAgent(id: string): AgentRecord | undefined {
    const row = one<AgentRow>(this.#statements.agentById, id);
    return row === undefined ? undefined : toAgent(row);
  }

  isNameTaken(name: string): boolean {
    return one(this.#statements.agentNamed, name) !== undefined;
  }

  listAgents(): AgentRecord[] {
    return all<AgentRow>(this.#statements.allAgents).map(toAgent);
  }

  renameAgent(id: string, name: string): AgentRecord {
    const row = this.#agentRow(id);
    try {
      this.#statements.renameAgent.run(name, row.ref);
    } catch (error) {
      if (isUniqueViolation(error)) throw new NameTakenError(name);
      throw error;
    }
    return this.#publishAgent(id);
  }

  updateAgent(id: string, change: AgentChange): AgentRecord {
    const row = this.#agentRow(id);
    const { colour, role, purpose, departmentId, autonomy, profileId, settings } = change;
    this.#statements.updateAgent.run(
      role ?? null,
      purpose ?? null,
      departmentId === undefined ? null : this.#departmentRow(departmentId).ref,
      autonomy ?? null,
      profileId === undefined ? null : this.#profileRow(profileId).ref,
      JSON.stringify(settings),
      colour ?? null,
      row.ref,
    );
    return this.#publishAgent(id);
  }

  createDepartment(department: NewDepartment): DepartmentRecord {
    const id = randomUUID();
    const [first, ...more] = department.workspaceIds;
    transaction(this.#db, () => {
      const { lastInsertRowid } = this.#statements.insertDepartment.run(
        id,
        department.name,
        this.#workspaceRow(first ?? "").ref,
        department.autonomy,
        this.#agentRow(department.leadAgentId).ref,
        department.branchPerWorker ? 1 : 0,
        department.codeFlow ? 1 : 0,
        textOrNull(department.rules),
        textOrNull(department.purpose),
        Date.now(),
      );
      this.#addWorkspaces(Number(lastInsertRowid), more);
    });
    return this.#publishDepartment(id);
  }

  // A removed department is gone for everything but the history that names it.
  getDepartment(id: string): DepartmentRecord | undefined {
    const row = one<DepartmentRow>(this.#statements.departmentById, id);
    return row === undefined || row.removedAt !== null ? undefined : toDepartment(row);
  }

  listDepartments(): DepartmentRecord[] {
    return all<DepartmentRow>(this.#statements.allDepartments).map(toDepartment);
  }

  updateDepartment(id: string, settings: DepartmentSettings): DepartmentRecord {
    const row = this.#departmentRow(id);
    const { name, workspaceIds, autonomy, branchPerWorker, codeFlow, rules, purpose } = settings;
    const [first, ...more] = workspaceIds;
    transaction(this.#db, () => {
      this.#statements.updateDepartment.run(
        name,
        autonomy,
        branchPerWorker ? 1 : 0,
        codeFlow ? 1 : 0,
        textOrNull(rules),
        textOrNull(purpose),
        row.ref,
      );
      this.#statements.setDepartmentWorkspace.run(this.#workspaceRow(first ?? "").ref, row.ref);
      this.#statements.clearDepartmentWorkspaces.run(row.ref);
      this.#addWorkspaces(row.ref, more);
    });
    return this.#publishDepartment(id);
  }

  #addWorkspaces(departmentRef: number, workspaceIds: string[]): void {
    for (const [position, workspaceId] of workspaceIds.entries()) {
      const workspace = this.#workspaceRow(workspaceId).ref;
      this.#statements.addDepartmentWorkspace.run(departmentRef, workspace, position);
    }
  }

  removeDepartment(id: string): void {
    const row = this.#departmentRow(id);
    const members = all<AgentRow>(this.#statements.membersOf, row.ref).map(toAgent);
    transaction(this.#db, () => {
      this.#statements.removeDepartment.run(Date.now(), row.ref);
      for (const { departmentId: _, ...member } of members) this.updateAgent(member.id, member);
    });
    this.#publish({ type: "department.removed", departmentId: id });
  }

  tasksOfDepartment(id: string): string[] {
    const ref = this.#departmentRow(id).ref;
    return all<{ id: string }>(this.#statements.tasksOfDepartment, ref).map((task) => task.id);
  }

  deleteDepartmentIfUnused(id: string): void {
    this.#statements.deleteDepartmentIfUnused.run(this.#departmentRow(id).ref);
  }

  deleteAgentIfUnused(id: string): void {
    this.#statements.deleteAgentIfUnused.run(this.#agentRow(id).ref);
  }

  listMembers(departmentId: string): AgentRecord[] {
    const ref = this.#departmentRow(departmentId).ref;
    return all<AgentRow>(this.#statements.membersOf, ref).map(toAgent);
  }

  accountUsageSince(since: string): ModelUsage[] {
    const rows = all<ModelUsage & { model: string | null }>(
      this.#statements.accountUsageSince,
      Date.parse(since),
    );
    return rows.map(({ model, ...row }) => (model === null ? row : { ...row, model }));
  }

  conversationUsage(harness: string, harnessSessionId: string): TokenUsage {
    return (
      one<TokenUsage>(this.#statements.conversationUsage, harnessSessionId, harness) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      }
    );
  }

  sessionsToRecount(harness: string, since: string): SessionRecord[] {
    return all<SessionRow>(this.#statements.sessionsToRecount, harness, Date.parse(since)).map(
      toSession,
    );
  }

  nextSequence(sessionId: string): number {
    const row = one<{ sequence: number }>(
      this.#statements.lastSequence,
      this.#sessionRef(sessionId),
    );
    return (row?.sequence ?? 0) + 1;
  }

  createAccount(account: Account): Account {
    const { id, harness, environment, name, folder = "", createdAt } = account;
    this.#statements.insertAccount.run(
      id,
      harness,
      JSON.stringify(environment),
      name,
      folder,
      Date.parse(createdAt),
    );
    return account;
  }

  getAccount(id: string): Account | undefined {
    const row = one<AccountRow>(this.#statements.accountById, id);
    return row === undefined ? undefined : toAccount(row);
  }

  listAccounts(): Account[] {
    return all<AccountRow>(this.#statements.allAccounts).map(toAccount);
  }

  renameAccount(id: string, name: string): Account {
    const account = this.getAccount(id);
    if (account === undefined) throw new RecordNotFoundError("account", id);
    this.#statements.renameAccount.run(name, id);
    return { ...account, name };
  }

  deleteAccount(id: string): void {
    this.#statements.deleteAccount.run(id);
  }

  createProfile({ name, role, colour, settings }: ProfileRequest): ProfileRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.#statements.insertProfile.run(id, name, role, colour, JSON.stringify(settings), createdAt);
    return { id, name, role, colour, settings, createdAt: iso(createdAt) };
  }

  getProfile(id: string): ProfileRecord | undefined {
    const row = one<ProfileRow>(this.#statements.profileById, id);
    return row === undefined ? undefined : toProfile(row);
  }

  listProfiles(): ProfileRecord[] {
    return all<ProfileRow>(this.#statements.allProfiles).map(toProfile);
  }

  updateProfile(id: string, { name, role, colour, settings }: ProfileRequest): ProfileRecord {
    const row = this.#profileRow(id);
    this.#statements.updateProfile.run(name, role, colour, JSON.stringify(settings), row.ref);
    return { ...toProfile(row), name, role, colour, settings };
  }

  deleteProfile(id: string): void {
    this.#statements.deleteProfile.run(this.#profileRow(id).ref);
  }

  createWorkspace({ name, kind, folders }: WorkspaceRequest): WorkspaceRecord {
    const id = randomUUID();
    const now = Date.now();
    this.#statements.insertWorkspace.run(id, name, kind, JSON.stringify(folders), now, now);
    return { id, name, kind, folders, createdAt: iso(now), usedAt: iso(now) };
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    const row = one<WorkspaceRow>(this.#statements.workspaceById, id);
    return row === undefined ? undefined : toWorkspace(row);
  }

  listWorkspaces(): WorkspaceRecord[] {
    return all<WorkspaceRow>(this.#statements.workspacesByUse).map(toWorkspace);
  }

  updateWorkspace(id: string, { name, kind, folders }: WorkspaceRequest): WorkspaceRecord {
    const row = this.#workspaceRow(id);
    this.#statements.updateWorkspace.run(name, kind, JSON.stringify(folders), row.ref);
    return { ...toWorkspace(row), name, kind, folders };
  }

  workspaceActivity(id: string): WorkspaceActivity {
    const { ref } = this.#workspaceRow(id);
    return {
      taskCount: one<{ count: number }>(this.#statements.taskCountOfWorkspace, ref)?.count ?? 0,
      recentTasks: all<TaskRow>(this.#statements.recentTasksOfWorkspace, ref).map((row) =>
        this.#toTask(row),
      ),
      openTaskIds: all<{ id: string }>(this.#statements.openTasksOfWorkspace, ref).map(
        (row) => row.id,
      ),
    };
  }

  deleteWorkspace(id: string): void {
    try {
      this.#statements.deleteWorkspace.run(this.#workspaceRow(id).ref);
    } catch (error) {
      if ((error as { errcode?: number }).errcode !== SQLITE_CONSTRAINT_FOREIGNKEY) throw error;
      throw new InUseError("A department works in this workspace, so it cannot be deleted.");
    }
  }

  useWorkspace(id: string): WorkspaceRecord {
    const row = this.#workspaceRow(id);
    const now = Date.now();
    this.#statements.workspaceUsed.run(now, row.ref);
    return toWorkspace({ ...row, usedAt: now });
  }

  saveFile({ kind, name, mimeType, content }: NewFile): Attachment {
    const id = randomUUID();
    const saved = this.#files.save(id, name, content);
    const createdAt = Date.now();
    this.#statements.insertAttachment.run(
      id,
      kind,
      name,
      saved.path,
      saved.bytes,
      mimeType ?? null,
      saved.sha256,
      createdAt,
    );
    return {
      id,
      kind,
      name,
      path: saved.path,
      bytes: saved.bytes,
      ...(mimeType === undefined ? {} : { mimeType }),
      sha256: saved.sha256,
      createdAt: iso(createdAt),
    };
  }

  linkFolder(path: string): Attachment {
    const id = randomUUID();
    const name = basename(path) || path;
    const createdAt = Date.now();
    this.#statements.insertAttachment.run(id, "folder", name, path, null, null, null, createdAt);
    return { id, kind: "folder", name, path, createdAt: iso(createdAt) };
  }

  getAttachment(id: string): Attachment | undefined {
    const row = one<AttachmentRow>(this.#statements.attachmentById, id);
    return row === undefined ? undefined : toAttachment(row);
  }

  attachmentAt(path: string): Attachment | undefined {
    const row = one<AttachmentRow>(this.#statements.latestAttachmentAt, path);
    return row === undefined ? undefined : toAttachment(row);
  }

  taskAttachments(taskId: string): Attachment[] {
    const { ref } = this.#taskRow(taskId);
    return all<AttachmentRow>(this.#statements.attachmentsOfTask, ref).map(toAttachment);
  }

  linkAttachments(taskId: string, attachmentIds: string[]): void {
    const { ref } = this.#taskRow(taskId);
    transaction(this.#db, () => {
      for (const id of attachmentIds) this.#statements.linkAttachment.run(ref, id);
    });
  }

  async deleteUnsentAttachments(before: Date): Promise<void> {
    const unsent = all<AttachmentRef>(this.#statements.unsentAttachments, before.getTime());
    transaction(this.#db, () => {
      for (const attachment of unsent) this.#statements.deleteAttachment.run(attachment.ref);
    });
    await this.#removeCopies(unsent);
  }

  listLibrary(): LibraryItem[] {
    return all<LibraryRow>(this.#statements.allLibraryItems).map(toLibraryItem);
  }

  getLibraryItem(id: string): LibraryItem | undefined {
    const row = one<LibraryRow>(this.#statements.libraryItemById, id);
    return row === undefined ? undefined : toLibraryItem(row);
  }

  libraryItemOf(attachmentId: string): LibraryItem | undefined {
    const file = one<AttachmentRow>(this.#statements.attachmentById, attachmentId);
    if (file === undefined) return undefined;
    const row = one<LibraryRow>(this.#statements.libraryItemOfFile, file.ref);
    return row === undefined ? undefined : toLibraryItem(row);
  }

  libraryOfWorkspace(workspaceId: string): LibraryItem[] {
    const { ref } = this.#workspaceRow(workspaceId);
    return all<LibraryRow>(this.#statements.libraryOfWorkspace, ref).map(toLibraryItem);
  }

  addLibraryItem({ workspaceId, attachmentId, givenTo, addedByAgentId }: NewLibraryItem) {
    const workspace = this.#workspaceRow(workspaceId);
    const file = this.#freeFile(attachmentId);
    const addedBy = addedByAgentId === undefined ? null : this.#agentRow(addedByAgentId).ref;
    const id = randomUUID();
    this.#statements.insertLibraryItem.run(
      id,
      workspace.ref,
      file.ref,
      JSON.stringify(givenTo),
      addedBy,
      Date.now(),
    );
    return this.#publishLibraryItem(id);
  }

  async changeLibraryItem(id: string, { attachmentId, givenTo }: LibraryItemChange) {
    const row = this.#libraryRow(id);
    const file = attachmentId === undefined ? undefined : this.#freeFile(attachmentId);
    transaction(this.#db, () => {
      if (givenTo !== undefined) {
        this.#statements.libraryGivenTo.run(JSON.stringify(givenTo), row.ref);
      }
      if (file !== undefined) this.#statements.libraryFile.run(file.ref, row.ref);
    });
    const item = this.#publishLibraryItem(id);
    if (file !== undefined)
      await this.#dropUnsent({ ref: row.fileRef, id: row.fileId, kind: row.kind });
    return item;
  }

  async removeLibraryItem(id: string): Promise<void> {
    const row = this.#libraryRow(id);
    this.#statements.deleteLibraryItem.run(row.ref);
    this.#publish({ type: "library.removed", itemId: id });
    await this.#dropUnsent({ ref: row.fileRef, id: row.fileId, kind: row.kind });
  }

  noteLibraryGiven(itemId: string, taskId: string): void {
    const added = this.#statements.noteLibraryGiven.run(
      this.#libraryRow(itemId).ref,
      this.#taskRow(taskId).ref,
    );
    if (added.changes > 0) this.#publishLibraryItem(itemId);
  }

  libraryUnopenedIn(taskId: string): UnopenedItem[] {
    const { ref } = this.#taskRow(taskId);
    return all<{ id: string; kind: Attachment["kind"]; path: string }>(
      this.#statements.libraryUnopenedIn,
      ref,
    ).map(({ id, kind, path }) => ({ itemId: id, kind, path }));
  }

  noteLibraryOpened(itemId: string, taskId: string, at: Date): void {
    const opened = this.#statements.noteLibraryOpened.run(
      at.getTime(),
      this.#libraryRow(itemId).ref,
      this.#taskRow(taskId).ref,
    );
    if (opened.changes > 0) this.#publishLibraryItem(itemId);
  }

  // An uploaded file not yet in the Library; one item per file, so Replace never moves another's.
  #freeFile(attachmentId: string): AttachmentRow {
    const file = one<AttachmentRow>(this.#statements.attachmentById, attachmentId);
    if (file === undefined) throw new RecordNotFoundError("attachment", attachmentId);
    if (one(this.#statements.libraryItemOfFile, file.ref) !== undefined) {
      throw new InUseError("That file is already in the Library.");
    }
    return file;
  }

  // A file the Library no longer holds goes now, unless a task was sent it; it then goes with
  // the last such task.
  async #dropUnsent(file: AttachmentRef): Promise<void> {
    if (one(this.#statements.attachmentSent, file.ref) !== undefined) return;
    this.#statements.deleteAttachment.run(file.ref);
    await this.#removeCopies([file]);
  }

  #libraryRow(id: string): LibraryRow {
    const row = one<LibraryRow>(this.#statements.libraryItemById, id);
    if (row === undefined) throw new RecordNotFoundError("library item", id);
    return row;
  }

  #publishLibraryItem(id: string): LibraryItem {
    const item = toLibraryItem(this.#libraryRow(id));
    this.#publish({ type: "library", item });
    return item;
  }

  // A linked folder is the user's own, so only copies are removed.
  async #removeCopies(attachments: AttachmentRef[]): Promise<void> {
    const copies = attachments.filter((attachment) => attachment.kind !== "folder");
    await Promise.all(copies.map((attachment) => this.#files.remove(attachment.id)));
  }

  createConnector({ setup, audience, permission, status, tools }: NewConnector): ConnectorRecord {
    const id = randomUUID();
    try {
      this.#statements.insertConnector.run(
        id,
        setup.slug,
        JSON.stringify(setup),
        JSON.stringify(audience),
        permission,
        1,
        status,
        JSON.stringify(tools),
        Date.now(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new InUseError(`Another connector already uses the name "${setup.slug}".`);
      }
      throw error;
    }
    return this.#publishConnector(id);
  }

  getConnector(id: string): ConnectorRecord | undefined {
    const row = one<ConnectorRow>(this.#statements.connectorById, id);
    return row === undefined ? undefined : toConnector(row);
  }

  listConnectors(): ConnectorRecord[] {
    return all<ConnectorRow>(this.#statements.allConnectors).map(toConnector);
  }

  updateConnector(id: string, update: ConnectorUpdate): ConnectorRecord {
    const row = this.#connectorRow(id);
    const current = toConnector(row);
    this.#statements.updateConnector.run(
      JSON.stringify(update.audience ?? current.audience),
      update.permission ?? current.permission,
      (update.enabled ?? current.enabled) ? 1 : 0,
      update.status ?? current.status,
      row.ref,
    );
    return this.#publishConnector(id);
  }

  connectorTools(id: string): ConnectorTool[] {
    const row = one<{ tools: string }>(this.#statements.connectorTools, id);
    if (row === undefined) throw new RecordNotFoundError("connector", id);
    return JSON.parse(row.tools) as ConnectorTool[];
  }

  saveConnectorTools(id: string, tools: ConnectorTool[]): void {
    this.#statements.saveConnectorTools.run(JSON.stringify(tools), this.#connectorRow(id).ref);
  }

  deleteConnector(id: string): void {
    this.#statements.deleteConnector.run(this.#connectorRow(id).ref);
    this.#publish({ type: "connector.removed", connectorId: id });
  }

  recordConnectorCall(call: NewConnectorCall): ConnectorCall {
    const session = this.getSession(call.sessionId);
    if (session === undefined) throw new RecordNotFoundError("session", call.sessionId);
    const departmentId = this.getAgent(session.agentId)?.departmentId;
    const id = randomUUID();
    this.#statements.insertConnectorCall.run(
      id,
      this.#connectorRow(call.connectorId).ref,
      this.#sessionRef(call.sessionId),
      departmentId === undefined ? null : this.#departmentRow(departmentId).ref,
      call.tool,
      inputText(call.input),
      call.change ? 1 : 0,
      call.outcome,
      Date.now(),
    );
    const row = one<ConnectorCallRow>(this.#statements.connectorCallById, id);
    if (row === undefined) throw new RecordNotFoundError("connector", call.connectorId);
    return toConnectorCall(row);
  }

  endConnectorCall(id: string, outcome: ConnectorCallOutcome): void {
    this.#statements.endConnectorCall.run(outcome, id);
  }

  connectorActivity(id: string, query: ConnectorActivityQuery, since: Date): ConnectorActivity {
    const { ref } = this.#connectorRow(id);
    const rows = all<ConnectorCallRow>(
      this.#statements.connectorCallsBefore,
      ref,
      since.getTime(),
      query.before ?? Number.MAX_SAFE_INTEGER,
      query.team ?? null,
      query.changes === true ? 1 : null,
      CONNECTOR_PAGE + 1,
    );
    const counts = all<{ departmentId: string | null; count: number; changes: number }>(
      this.#statements.connectorCallCounts,
      ref,
      since.getTime(),
    );
    const calls = rows.slice(0, CONNECTOR_PAGE).map(toConnectorCall);
    const last = calls.at(-1);
    return {
      calls,
      total: counts.reduce((sum, row) => sum + row.count, 0),
      changes: counts.reduce((sum, row) => sum + row.changes, 0),
      teams: counts.map(({ departmentId, count }) =>
        departmentId === null ? { count } : { departmentId, count },
      ),
      ...(rows.length > CONNECTOR_PAGE && last !== undefined ? { next: last.position } : {}),
    };
  }

  #connectorRow(id: string): ConnectorRow {
    const row = one<ConnectorRow>(this.#statements.connectorById, id);
    if (row === undefined) throw new RecordNotFoundError("connector", id);
    return row;
  }

  #publishConnector(id: string): ConnectorRecord {
    const connector = toConnector(this.#connectorRow(id));
    this.#publish({ type: "connector", connector });
    return connector;
  }

  readSettings(): Settings {
    const settings: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      const row = one<{ value: string }>(this.#statements.settingByKey, key);
      if (row !== undefined) settings[key] = JSON.parse(row.value);
    }
    return settings as Settings;
  }

  saveSettings(settings: Settings): void {
    transaction(this.#db, () => {
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined) this.#statements.saveSetting.run(key, JSON.stringify(value));
      }
    });
  }

  clearSetting(key: keyof Settings): void {
    this.#statements.deleteSetting.run(key);
  }

  async size(): Promise<StoreSize> {
    const [database, log, results] = await Promise.all([
      fileSize(this.#file),
      fileSize(`${this.#file}-wal`),
      this.#results.size(),
    ]);
    return { databaseBytes: database + log, resultBytes: results };
  }

  close(): void {
    this.#db.exec("PRAGMA optimize");
    this.#db.close();
  }

  #summarize(row: TaskRow): TaskSummary {
    const sessions = all<SessionRow>(this.#statements.sessionsOfTask, row.ref).map(toSession);
    return { ...this.#toTask(row), sessions };
  }

  #toTask(row: TaskRow): TaskRecord {
    return toTask(row, all<TaskUsage>(this.#statements.usageOfTask, row.ref));
  }

  #publishTask(id: string): TaskRecord {
    const task = this.#toTask(this.#taskRow(id));
    this.#publish({ type: "task", task });
    return task;
  }

  #publishAgent(id: string): AgentRecord {
    const agent = toAgent(this.#agentRow(id));
    this.#publish({ type: "agent", agent });
    return agent;
  }

  #publishDepartment(id: string): DepartmentRecord {
    const department = toDepartment(this.#departmentRow(id));
    this.#publish({ type: "department", department });
    return department;
  }

  #publishPiece(id: string): PlanPiece {
    const piece = toPiece(this.#pieceRow(id));
    this.#publish({ type: "piece", piece });
    return piece;
  }

  // Changes made by a listener wait their turn, so every listener sees them in order.
  #publish(change: Change): void {
    this.#outbox.push(change);
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      for (let next = this.#outbox.shift(); next !== undefined; next = this.#outbox.shift()) {
        for (const listener of this.#listeners) this.#deliver(listener, next);
      }
    } finally {
      this.#publishing = false;
    }
  }

  // The write is committed whatever a listener does, so one failing listener must not stop the others.
  #deliver(listener: ChangeListener, change: Change): void {
    try {
      listener(change);
    } catch (error) {
      console.error(`A listener failed on a "${change.type}" change.`, error);
    }
  }

  #taskRow(id: string): TaskRow {
    const row = one<TaskRow>(this.#statements.taskById, id);
    if (row === undefined) throw new RecordNotFoundError("task", id);
    return row;
  }

  #pieceRow(id: string): PieceRow {
    const row = one<PieceRow>(this.#statements.pieceById, id);
    if (row === undefined) throw new RecordNotFoundError("piece", id);
    return row;
  }

  #delegationRow(id: string): DelegationRow {
    const row = one<DelegationRow>(this.#statements.delegationById, id);
    if (row === undefined) throw new RecordNotFoundError("delegation", id);
    return row;
  }

  #departmentRow(id: string): DepartmentRow {
    const row = one<DepartmentRow>(this.#statements.departmentById, id);
    if (row === undefined) throw new RecordNotFoundError("department", id);
    return row;
  }

  #agentRow(id: string): AgentRow {
    const row = one<AgentRow>(this.#statements.agentById, id);
    if (row === undefined) throw new RecordNotFoundError("agent", id);
    return row;
  }

  #profileRow(id: string): ProfileRow {
    const row = one<ProfileRow>(this.#statements.profileById, id);
    if (row === undefined) throw new RecordNotFoundError("profile", id);
    return row;
  }

  #workspaceRow(id: string): WorkspaceRow {
    const row = one<WorkspaceRow>(this.#statements.workspaceById, id);
    if (row === undefined) throw new RecordNotFoundError("workspace", id);
    return row;
  }

  #sessionRef(id: string): number {
    const row = one<{ ref: number }>(this.#statements.sessionRef, id);
    if (row === undefined) throw new RecordNotFoundError("session", id);
    return row.ref;
  }

  #keepLargeTextApart(event: SessionEvent): SessionEvent {
    if (event.type === "action.ended") {
      const kept = this.#results.keepApart(event.sessionId, event.sequence, event.payload.result);
      if (kept === undefined) return event;
      return {
        ...event,
        payload: { ...event.payload, result: kept.preview, overflow: kept.overflow },
      };
    }
    if (event.type === "action.updated" && event.payload.output !== undefined) {
      const kept = previewOutput(event.payload.output);
      if (kept === undefined) return event;
      return {
        ...event,
        payload: { ...event.payload, output: kept.preview, overflow: kept.overflow },
      };
    }
    return event;
  }

  // The session row summarises its log, so it changes in the same transaction as the event.
  #updateSession(sessionRef: number, event: SessionEvent): void {
    if (event.type === "session.started") {
      this.#statements.sessionStarted.run(event.payload.harnessSessionId, sessionRef);
    }
    if (event.type === "session.ended") {
      this.#statements.sessionEnded.run(
        event.payload.reason,
        Date.parse(event.timestamp),
        sessionRef,
      );
    }
  }

  // In the event's own transaction; returns what to publish once it commits.
  #updateUsage(sessionRef: number, event: SessionEvent): Change | undefined {
    if (event.type === "limits.updated") {
      const { harness, accountId } = this.#sessionTask(sessionRef);
      const { limits } = event.payload;
      const reportedAt = Date.parse(event.timestamp);
      this.#statements.saveLimits.run(accountId, harness, JSON.stringify(limits), reportedAt);
      return {
        type: "limits",
        limits: { accountId, harness, limits, reportedAt: event.timestamp },
      };
    }
    if (event.type !== "turn.ended" && event.type !== "usage.recounted") return undefined;
    if (event.payload.usage === undefined) return undefined;
    const { usage } = event.payload;
    const { taskRef, harness } = this.#sessionTask(sessionRef);
    this.#statements.addTaskUsage.run(
      taskRef,
      harness,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens ?? 0,
    );
    const task = one<TaskRow>(this.#statements.taskByRef, taskRef);
    return task === undefined ? undefined : { type: "task", task: this.#toTask(task) };
  }

  #sessionTask(sessionRef: number): { taskRef: number; harness: string; accountId: string } {
    const row = one<{ taskRef: number; harness: string; accountId: string }>(
      this.#statements.sessionTaskAndHarness,
      sessionRef,
    );
    if (row === undefined) throw new RecordNotFoundError("session", String(sessionRef));
    return row;
  }

  // A session that ended can answer nothing, whether or not the harness closed each request.
  #updatePendingRequests(sessionRef: number, position: number, event: SessionEvent): void {
    switch (event.type) {
      case "permission.requested":
      case "question.requested":
      case "proposal.requested":
      case "plan.requested":
      case "checklist.requested":
        this.#statements.insertPendingRequest.run(position, sessionRef, event.payload.requestId);
        return;
      case "permission.resolved":
      case "question.resolved":
      case "proposal.resolved":
      case "plan.resolved":
      case "checklist.resolved":
        this.#statements.deletePendingRequest.run(sessionRef, event.payload.requestId);
        return;
      case "session.ended":
        this.#statements.deleteSessionPendingRequests.run(sessionRef);
        return;
    }
  }

  async #deleteInChunks(statement: StatementSync, sessionRef: number): Promise<void> {
    while (statement.run(sessionRef, DELETE_CHUNK).changes > 0) await yieldToEventLoop();
  }

  // Now, not when the app next closes.
  async #returnFreeSpace(): Promise<void> {
    const pages = readNumber(this.#db, "PRAGMA freelist_count");
    for (let freed = 0; freed < pages; freed += VACUUM_STEP_PAGES) {
      this.#db.exec(`PRAGMA incremental_vacuum(${VACUUM_STEP_PAGES})`);
      await yieldToEventLoop();
    }
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}
