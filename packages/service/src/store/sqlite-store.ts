import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  type AgentRecord,
  type AgentSettings,
  type PendingRequestList,
  type ProfileRecord,
  type ProfileRequest,
  type SessionEvent,
  type SessionOptions,
  type SessionRecord,
  type SessionStatus,
  type Settings,
  type StoreSize,
  settingsSchema,
  type TaskPage,
  type TaskRecord,
  type TaskSummary,
  type UserRequestEvent,
  type WorkspaceRecord,
  type WorkspaceRequest,
} from "@office-town/contract";
import { openDatabase, readNumber, transaction } from "./database.ts";
import { queries } from "./queries.ts";
import { fileSize, previewOutput, ResultFiles, utf8Prefix } from "./result-files.ts";
import {
  type EventQuery,
  type LineDirection,
  NameTakenError,
  type NewAgentRecord,
  type NewSession,
  RecordNotFoundError,
  type Store,
  type StoredEvent,
  TaskActiveError,
  type TaskQuery,
} from "./store.ts";

// Deleting a long session in one statement blocks the process for most of a second; in chunks,
// live updates get through between them. Freed pages go back to the disk in steps for the same
// reason.
const DELETE_CHUNK = 1000;
const VACUUM_STEP_PAGES = 500;
const LINE_CAP_BYTES = 64 * 1024;

interface TaskRow {
  ref: number;
  id: string;
  prompt: string;
  createdAt: number;
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
  profileId: string | null;
  settings: string;
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
  folders: string;
  createdAt: number;
  usedAt: number;
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

function toTask(row: TaskRow): TaskRecord {
  return { id: row.id, prompt: row.prompt, createdAt: iso(row.createdAt) };
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
    ...(row.profileId === null ? {} : { profileId: row.profileId }),
    settings: JSON.parse(row.settings) as AgentSettings,
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

// SQLite's own code for a broken UNIQUE constraint.
const SQLITE_CONSTRAINT_UNIQUE = 2067;

function isUniqueViolation(error: unknown): boolean {
  return (error as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE;
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    folders: JSON.parse(row.folders) as string[],
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
  return new SqliteStore(openDatabase(file), file, new ResultFiles(join(directory, "results")));
}

class SqliteStore implements Store {
  readonly #db: DatabaseSync;
  readonly #file: string;
  readonly #results: ResultFiles;
  readonly #statements: Statements;
  // While a task's rows are deleted in chunks, no new session may join it.
  readonly #deleting = new Set<string>();

  constructor(db: DatabaseSync, file: string, results: ResultFiles) {
    this.#db = db;
    this.#file = file;
    this.#results = results;
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Statements;
  }

  createTask(prompt: string): TaskRecord {
    const task = { id: randomUUID(), prompt, createdAt: Date.now() };
    this.#statements.insertTask.run(task.id, task.prompt, task.createdAt);
    return { ...task, createdAt: iso(task.createdAt) };
  }

  getTask(id: string): TaskRecord | undefined {
    const row = one<TaskRow>(this.#statements.taskById, id);
    return row === undefined ? undefined : toTask(row);
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
      transaction(this.#db, () => {
        this.#statements.deleteTask.run(task.ref);
        for (const ref of new Set(agents.map((agent) => agent.ref))) {
          this.#statements.deleteAgentIfUnused.run(ref, ref);
        }
      });
      await Promise.all(sessions.map((session) => this.#results.remove(session.id)));
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

  getSession(id: string): SessionRecord | undefined {
    const row = one<SessionRow>(this.#statements.sessionById, id);
    return row === undefined ? undefined : toSession(row);
  }

  listSessions(taskId: string): SessionRecord[] {
    return all<SessionRow>(this.#statements.sessionsOfTask, this.#taskRow(taskId).ref).map(
      toSession,
    );
  }

  markInterrupted(): SessionRecord[] {
    return transaction(this.#db, () => {
      const sessions = all<SessionRow>(this.#statements.unfinishedSessions);
      this.#statements.deleteUnfinishedPendingRequests.run();
      this.#statements.interruptUnfinished.run();
      return sessions.map((row) => ({ ...toSession(row), status: "interrupted" as const }));
    });
  }

  append(event: SessionEvent): StoredEvent | undefined {
    if (event.type === "message.delta" || event.type === "reasoning.delta") return undefined;
    const sessionRef = this.#sessionRef(event.sessionId);
    // A file is written before its row; if the row then fails, the file is removed with its session.
    const stored = this.#keepLargeTextApart(event);
    const position = transaction(this.#db, () => {
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
      return position;
    });
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

  createAgent({ name, colour, role, profileId, settings }: NewAgentRecord): AgentRecord {
    const id = randomUUID();
    const profileRef = profileId === undefined ? null : this.#profileRow(profileId).ref;
    const createdAt = Date.now();
    try {
      this.#statements.insertAgent.run(
        id,
        name,
        colour,
        role ?? null,
        profileRef,
        JSON.stringify(settings),
        createdAt,
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new NameTakenError(name);
      throw error;
    }
    return {
      id,
      name,
      colour,
      ...(role === undefined ? {} : { role }),
      ...(profileId === undefined ? {} : { profileId }),
      settings,
      createdAt: iso(createdAt),
    };
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
    return toAgent({ ...row, name });
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

  createWorkspace({ name, folders }: WorkspaceRequest): WorkspaceRecord {
    const id = randomUUID();
    const now = Date.now();
    this.#statements.insertWorkspace.run(id, name, JSON.stringify(folders), now, now);
    return { id, name, folders, createdAt: iso(now), usedAt: iso(now) };
  }

  listWorkspaces(): WorkspaceRecord[] {
    return all<WorkspaceRow>(this.#statements.workspacesByUse).map(toWorkspace);
  }

  updateWorkspace(id: string, { name, folders }: WorkspaceRequest): WorkspaceRecord {
    const row = this.#workspaceRow(id);
    this.#statements.updateWorkspace.run(name, JSON.stringify(folders), row.ref);
    return { ...toWorkspace(row), name, folders };
  }

  deleteWorkspace(id: string): void {
    this.#statements.deleteWorkspace.run(this.#workspaceRow(id).ref);
  }

  useWorkspace(id: string): WorkspaceRecord {
    const row = this.#workspaceRow(id);
    const now = Date.now();
    this.#statements.workspaceUsed.run(now, row.ref);
    return toWorkspace({ ...row, usedAt: now });
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
    return { ...toTask(row), sessions };
  }

  #taskRow(id: string): TaskRow {
    const row = one<TaskRow>(this.#statements.taskById, id);
    if (row === undefined) throw new RecordNotFoundError("task", id);
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

  // The waiting requests change with the events that open and close them. A session that ended
  // can answer nothing, whether or not the harness closed each request first.
  #updatePendingRequests(sessionRef: number, position: number, event: SessionEvent): void {
    switch (event.type) {
      case "permission.requested":
      case "question.requested":
        this.#statements.insertPendingRequest.run(position, sessionRef, event.payload.requestId);
        return;
      case "permission.resolved":
      case "question.resolved":
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

  // Hands the freed space back to the disk now, not when the app next closes.
  async #returnFreeSpace(): Promise<void> {
    const pages = readNumber(this.#db, "PRAGMA freelist_count");
    for (let freed = 0; freed < pages; freed += VACUUM_STEP_PAGES) {
      this.#db.exec(`PRAGMA incremental_vacuum(${VACUUM_STEP_PAGES})`);
      await yieldToEventLoop();
    }
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}
