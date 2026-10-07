import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type Change,
  type SessionEvent,
  type SessionEventBody,
  type SessionOptions,
  sessionEventSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/database.ts";
import { migrations } from "../src/store/migrations.ts";
import { queries } from "../src/store/queries.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import {
  RecordNotFoundError,
  type Store,
  StoreFileError,
  TaskActiveError,
} from "../src/store/store.ts";
import { addAgent } from "./support/agents.ts";

const options: SessionOptions = {
  harness: "claude",
  environment: { kind: "native" },
  permissionMode: "ask",
};

let directory: string;
let store: Store;

function startSession(
  taskId: string,
  { harness = "claude", agentId = addAgent(store).id } = {},
): { id: string; emit: (body: SessionEventBody) => void } {
  const id = randomUUID();
  store.createSession({ id, taskId, agentId, options: { ...options, harness } });
  let sequence = 0;
  const emit = (body: SessionEventBody) => {
    sequence += 1;
    const timestamp = new Date().toISOString();
    store.append({ id: randomUUID(), sessionId: id, sequence, timestamp, ...body } as SessionEvent);
  };
  return { id, emit };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "office-town-store-"));
  store = openStore(directory);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("store", () => {
  it("logs events in order, skips text fragments, keeps large text out of the database and summarises the session", () => {
    const task = store.createTask("Write a report");
    const first = startSession(task.id);
    const second = startSession(task.id);
    // Two bytes per "é" after one "a", so each preview's byte limit falls inside a character.
    const longResult = `a${"é".repeat(20_000)}`;
    first.emit({ type: "session.started", payload: { harnessSessionId: "native-1" } });
    first.emit({ type: "message.delta", payload: { text: "Hel" } });
    first.emit({ type: "message", payload: { role: "assistant", text: "Hello" } });
    second.emit({ type: "turn.started", payload: { turnId: "turn-1" } });
    first.emit({
      type: "action.updated",
      payload: { actionId: "read-1", output: `${longResult}a` },
    });
    first.emit({
      type: "action.ended",
      payload: { actionId: "read-1", outcome: "completed", result: longResult },
    });
    first.emit({ type: "session.ended", payload: { reason: "exited", exitCode: 0 } });

    const all = store.readEvents({ after: 0, limit: 100 });
    expect(all.map(({ event }) => event.type)).toEqual([
      "session.started",
      "message",
      "turn.started",
      "action.updated",
      "action.ended",
      "session.ended",
    ]);
    expect(all.map(({ position }) => position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const { event } of all) sessionEventSchema.parse(event);
    expect(store.readEvents({ after: 2, limit: 100, sessionId: first.id }).length).toBe(3);

    const updated = all[3]?.event;
    if (updated?.type !== "action.updated") throw new Error("expected the action to update");
    expect(updated.payload.overflow).toEqual({ bytes: 40_002, truncated: true });
    expect(updated.payload.output).toBe(`${"é".repeat(2047)}a`);
    expect(() => store.readOverflow(first.id, updated.sequence)).toThrow(RecordNotFoundError);

    const ended = all[4]?.event;
    if (ended?.type !== "action.ended") throw new Error("expected the action to end");
    expect(ended.payload.overflow).toEqual({ bytes: 40_001, truncated: false });
    expect(ended.payload.result).toBe(longResult.slice(0, 2048));
    expect(store.readOverflow(first.id, ended.sequence)).toBe(longResult);

    store.appendHarnessLine(first.id, "in", "x".repeat(100_000));
    // The store holds its file alone, so the raw line is read once it is closed.
    store.close();
    const raw = new DatabaseSync(join(directory, "store.db"));
    expect(
      raw.prepare("SELECT length(line) AS kept, full_bytes AS full FROM harness_lines").get(),
    ).toEqual({ kept: 65_536, full: 100_000 });
    raw.close();
    store = openStore(directory);

    expect(store.getSession(first.id)).toMatchObject({
      status: "exited",
      harnessSessionId: "native-1",
      endedAt: expect.any(String),
    });
    expect(store.markInterrupted().map((session) => session.id)).toEqual([second.id]);
    expect(store.listSessions(task.id).map((session) => session.status)).toEqual([
      "exited",
      "interrupted",
    ]);
  });

  it("keeps its data across a reopen and refuses a file it cannot read or another core holds", () => {
    const task = store.createTask("Survive a restart");
    store.close();
    store = openStore(directory);
    expect(store.listTasks({ limit: 10 })).toEqual({ tasks: [{ ...task, sessions: [] }] });
    expect(() => openStore(directory)).toThrow(StoreFileError);
    store.close();

    const file = join(directory, "store.db");
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => openStore(directory)).toThrow(StoreFileError);

    const unrelated = join(directory, "unrelated.db");
    const other = new DatabaseSync(unrelated);
    other.exec("CREATE TABLE notes (text TEXT)");
    other.close();
    expect(() => openDatabase(unrelated)).toThrow(StoreFileError);
    // The cleanup after each test closes whichever store is open.
    store = openStore(join(directory, "fresh"));
  });

  it("gives each task of an earlier version its agent, with the name and colour M3 showed and the level its permissions meant", () => {
    store.close();
    const file = join(directory, "m3", "store.db");
    mkdirSync(dirname(file));
    const m3 = new DatabaseSync(file);
    for (const sql of migrations.slice(0, 2)) m3.exec(sql as string);
    m3.exec(`
      PRAGMA application_id = ${0x4f54_4f57};
      PRAGMA user_version = 2;
      INSERT INTO tasks (ref, id, prompt, created_at) VALUES (1, 'task-1', 'Write a report', 0);
      INSERT INTO sessions (ref, id, task_ref, options, status, created_at) VALUES
        (1, '5f0c3b7e-9a41-4d2e-8b6f-1c2d3e4f5a6b', 1,
         '{"harness":"opencode","environment":{"kind":"native"},"model":"m","permissionMode":"ask"}',
         'exited', 0),
        (2, 'resumed', 1, '{"harness":"opencode","environment":{"kind":"native"},"permissionMode":"acceptEdits"}',
         'exited', 0);
      INSERT INTO events (session_ref, sequence, id, type, timestamp, payload) VALUES
        (1, 1, 'e1', 'turn.ended', 0,
         '{"turnId":"t","outcome":"completed","usage":{"inputTokens":10,"outputTokens":2}}'),
        (2, 1, 'e2', 'turn.ended', 0,
         '{"turnId":"t","outcome":"completed","usage":{"inputTokens":5,"outputTokens":1,"cachedInputTokens":3}}');
    `);
    m3.close();

    store = openStore(dirname(file));
    const [agent] = store.listAgents();
    expect(agent).toMatchObject({
      name: "@gil-4498",
      colour: "#A2456E",
      autonomy: "trusted",
      settings: { harness: "opencode", environment: { kind: "native" }, model: "m" },
    });
    expect(store.listSessions("task-1").map((session) => session.agentId)).toEqual([
      agent?.id,
      agent?.id,
    ]);
    // The harness itself now only asks; the level answers what it allows.
    expect(store.getSession("resumed")?.options.permissionMode).toBe("ask");
    // Old history counts as finished and reviewed, with its usage summed from the stored turns.
    expect(store.getTask("task-1")).toMatchObject({
      state: "ended",
      reviewedAt: expect.any(String),
      usage: [{ harness: "opencode", inputTokens: 15, outputTokens: 3, cachedInputTokens: 3 }],
    });
  });

  it("deletes a finished task with its sessions, events, harness lines and result files", async () => {
    const task = store.createTask("Delete me");
    const session = startSession(task.id);
    session.emit({ type: "session.started", payload: { harnessSessionId: "native-1" } });
    session.emit({
      type: "action.ended",
      payload: { actionId: "read-1", outcome: "completed", result: "x".repeat(20_000) },
    });
    for (let line = 0; line < 6000; line += 1) store.appendHarnessLine(session.id, "in", "{}");
    await expect(store.deleteTask(task.id)).rejects.toThrow(TaskActiveError);

    session.emit({ type: "session.ended", payload: { reason: "stopped", exitCode: 0 } });
    const before = await store.size();
    expect(before.resultBytes).toBe(20_000);
    const deleting = store.deleteTask(task.id);
    expect(() => startSession(task.id)).toThrow(RecordNotFoundError);
    await deleting;

    expect(store.getTask(task.id)).toBeUndefined();
    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.readEvents({ after: 0, limit: 100 })).toEqual([]);
    expect(existsSync(join(directory, "results", session.id))).toBe(false);
    const after = await store.size();
    expect(after.resultBytes).toBe(0);
    expect(after.databaseBytes).toBeLessThan(before.databaseBytes);
  });

  it("keeps each request for the user waiting until it is answered or its session cannot answer", () => {
    const firstTask = store.createTask("Edit the report");
    const secondTask = store.createTask("Plan a trip");
    const first = startSession(firstTask.id);
    const second = startSession(secondTask.id);
    const askPermission = (requestId: string) =>
      first.emit({
        type: "permission.requested",
        payload: {
          requestId,
          title: "Edit report.md",
          input: {},
          options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
        },
      });
    const waiting = () =>
      store
        .listPendingRequests()
        .requests.map(({ taskId, event }) => [taskId, event.payload.requestId]);

    askPermission("p-1");
    second.emit({
      type: "question.requested",
      payload: {
        requestId: "q-1",
        questions: [{ questionId: "where", text: "Where to?", options: [], multiSelect: false }],
      },
    });
    askPermission("p-2");
    first.emit({
      type: "permission.resolved",
      payload: { requestId: "p-1", outcome: "allowed", optionId: "allow" },
    });

    expect(waiting()).toEqual([
      [secondTask.id, "q-1"],
      [firstTask.id, "p-2"],
    ]);
    expect(store.listPendingRequests().position).toBe(4);
    first.emit({ type: "session.ended", payload: { reason: "failed", exitCode: 1 } });
    expect(waiting()).toEqual([[secondTask.id, "q-1"]]);
    // What an earlier core left waiting can no longer be answered.
    store.markInterrupted();
    expect(waiting()).toEqual([]);
  });

  it("pages tasks newest first with their sessions, even after the last task shown is deleted, and lists the active ones apart", async () => {
    const oldest = store.createTask("one");
    const middle = store.createTask("two");
    const newest = store.createTask("three");
    const running = startSession(oldest.id);
    startSession(middle.id).emit({
      type: "session.ended",
      payload: { reason: "exited", exitCode: 0 },
    });

    const first = store.listTasks({ limit: 1 });
    expect(first.tasks).toEqual([{ ...newest, sessions: [] }]);
    await store.deleteTask(newest.id);
    const rest = store.listTasks({ limit: 2, cursor: first.next ?? "" });
    expect(rest.tasks.map(({ id, sessions }) => [id, sessions.length])).toEqual([
      [middle.id, 1],
      [oldest.id, 1],
    ]);
    expect(store.listActiveTasks()).toEqual([
      { ...oldest, sessions: [store.getSession(running.id)] },
    ]);
  });

  it("sums each task's tokens by harness and keeps each harness's latest limits, telling listeners", () => {
    const changes: Change[] = [];
    store.subscribe((change) => changes.push(change));
    const task = store.createTask("Write a report");
    const claude = startSession(task.id);
    const opencode = startSession(task.id, { harness: "opencode" });
    const turnEnded = (inputTokens: number, cachedInputTokens?: number): SessionEventBody => ({
      type: "turn.ended",
      payload: {
        turnId: "turn",
        outcome: "completed",
        usage: {
          inputTokens,
          outputTokens: 1,
          ...(cachedInputTokens ? { cachedInputTokens } : {}),
        },
      },
    });
    const limits = (usedFraction: number): SessionEventBody => ({
      type: "limits.updated",
      payload: { limits: [{ id: "five_hour", label: "5 hours", usedFraction }] },
    });
    claude.emit(turnEnded(100, 40));
    claude.emit(limits(0.2));
    opencode.emit(turnEnded(7));
    claude.emit(turnEnded(50));
    claude.emit(limits(0.3));

    const usage = [
      { harness: "claude", inputTokens: 150, outputTokens: 2, cachedInputTokens: 40 },
      { harness: "opencode", inputTokens: 7, outputTokens: 1, cachedInputTokens: 0 },
    ];
    expect(store.getTask(task.id)?.usage).toEqual(usage);
    expect(store.listLimits()).toEqual([
      {
        harness: "claude",
        limits: [{ id: "five_hour", label: "5 hours", usedFraction: 0.3 }],
        reportedAt: expect.any(String),
      },
    ]);
    expect(changes.at(-2)).toEqual({ type: "task", task: store.getTask(task.id) });
    expect(changes.at(-1)).toEqual({ type: "limits", limits: store.listLimits()[0] });
  });

  it("pages an agent's sessions across its tasks, newest first", () => {
    const agentId = addAgent(store).id;
    const ids = ["one", "two", "three"].map((prompt) => {
      const task = store.createTask(prompt);
      startSession(task.id);
      return startSession(task.id, { agentId }).id;
    });

    const first = store.listAgentSessions(agentId, { limit: 2 });
    expect(first.sessions.map((session) => session.id)).toEqual([ids[2], ids[1]]);
    const rest = store.listAgentSessions(agentId, { limit: 2, before: first.next ?? "" });
    expect(rest).toEqual({ sessions: [store.getSession(ids[0] ?? "")] });
  });

  it("keeps a chief's plan with its goal: its pieces go with it, the departments' tasks stay", async () => {
    const chief = addAgent(store);
    const goal = store.createTask("Launch the bakery", { leadAgentId: chief.id });
    const later = store.createTask(
      "Open a second shop",
      { leadAgentId: chief.id },
      { queued: true },
    );
    expect(later.state).toBe("queued");
    expect(store.oldestQueuedTask()).toBe(later.id);
    expect(store.openTaskOfLead(chief.id)).toBe(goal.id);
    const changes: Change[] = [];
    store.subscribe((change) => changes.push(change));
    const newDepartment = {
      name: "Web team",
      purpose: "Builds the site",
      lead: { harness: "claude", environment: { kind: "native" as const } },
      workspaceId: "w",
      autonomy: "trusted" as const,
    };
    const site = store.createPiece({
      taskId: goal.id,
      key: "site",
      title: "Build the site",
      brief: "Build it",
      waitsOn: [],
      newDepartment,
    });
    const work = store.createTask("Build it", undefined, { parentTaskId: goal.id });
    store.updatePiece(site.id, { status: "working", pieceTaskId: work.id });
    expect(store.pieceOfTask(work.id)).toMatchObject({ id: site.id, status: "working" });
    expect(store.listOpenPieces().map((piece) => piece.id)).toEqual([site.id]);
    expect(store.updatePiece(site.id, { status: "done", result: "Live" })).toMatchObject({
      result: "Live",
      endedAt: expect.any(String),
    });
    expect(changes.filter((change) => change.type === "piece")).toHaveLength(3);

    await store.deleteTask(goal.id);
    expect(store.getPiece(site.id)).toBeUndefined();
    expect(store.getTask(work.id)?.parentTaskId).toBeUndefined();
  });

  // A query that loses its index reads the whole table and slows down with every event stored.
  it("answers every query through an index", () => {
    store.close();
    const db = openDatabase(join(directory, "store.db"));
    const plan = (sql: string) =>
      db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail))
        .join("\n");
    // These read a small table whole on purpose: what is waiting now, and the saved workspaces,
    // agents, profiles and departments, and the latest limits of each harness.
    const wholeTableReads = new Set([
      "pendingRequests",
      "workspacesByUse",
      "allAgents",
      "allProfiles",
      "allDepartments",
      "allLimits",
    ]);
    for (const [name, sql] of Object.entries(queries)) {
      if (!wholeTableReads.has(name)) expect(plan(sql), name).not.toMatch(/SCAN |TEMP B-TREE/);
    }
    // A range over the primary key is still a search, so these must name the index they rely on.
    const required: [string, string][] = [
      [queries.sessionEventsAfter, "events_by_session"],
      [queries.deleteSessionEvents, "events_by_session"],
      [queries.deleteSessionHarnessLines, "harness_lines_by_session"],
      [queries.sessionsOfTask, "sessions_by_task"],
      [queries.agentSessionsBefore, "sessions_by_agent"],
      [queries.activeTaskOfDepartment, "tasks_open_by_department"],
      [queries.latestTurnOfSession, "events_turns"],
      [queries.promptAfterTurn, "events_turns"],
      [queries.promptAfterTurn, "events_by_session"],
      [queries.unfinishedSessions, "sessions_unfinished"],
      [queries.deleteSessionPendingRequests, "pending_requests_by_session"],
      [queries.deleteUnfinishedPendingRequests, "sessions_unfinished"],
      [queries.openTaskOfLead, "tasks_open_by_lead"],
      [queries.oldestQueuedTask, "tasks_queued"],
      [queries.lastAgentMessage, "events_messages"],
      [queries.openPieces, "plan_pieces_open"],
      // The foreign-key checks SQLite runs when a chief's task, or a piece's, is deleted.
      ["DELETE FROM tasks WHERE ref = ?", "plan_pieces_by_task"],
      ["DELETE FROM tasks WHERE ref = ?", "plan_pieces_by_piece_task"],
      ["DELETE FROM tasks WHERE ref = ?", "tasks_by_parent"],
      // The foreign-key checks SQLite runs when a session row is deleted with its task.
      ["DELETE FROM sessions WHERE ref = ?", "events_by_session"],
      ["DELETE FROM sessions WHERE ref = ?", "harness_lines_by_session"],
      ["DELETE FROM sessions WHERE ref = ?", "sessions_by_resumed_from"],
      ["DELETE FROM sessions WHERE ref = ?", "pending_requests_by_session"],
    ];
    for (const [sql, index] of required) expect(plan(sql)).toContain(index);
    db.close();
    store = openStore(directory);
  });
});
