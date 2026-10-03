import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type SessionEvent,
  type SessionEventBody,
  type SessionOptions,
  sessionEventSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/database.ts";
import { queries } from "../src/store/queries.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import {
  RecordNotFoundError,
  type Store,
  StoreFileError,
  TaskActiveError,
} from "../src/store/store.ts";

const options: SessionOptions = {
  harness: "claude",
  environment: { kind: "native" },
  permissionMode: "ask",
};

let directory: string;
let store: Store;

function startSession(taskId: string): { id: string; emit: (body: SessionEventBody) => void } {
  const id = randomUUID();
  store.createSession({ id, taskId, options });
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
    const raw = new DatabaseSync(join(directory, "store.db"));
    expect(
      raw.prepare("SELECT length(line) AS kept, full_bytes AS full FROM harness_lines").get(),
    ).toEqual({ kept: 65_536, full: 100_000 });
    raw.close();

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

  it("keeps its data across a reopen and refuses a file it cannot read", () => {
    const task = store.createTask("Survive a restart");
    store.close();
    store = openStore(directory);
    expect(store.listTasks({ limit: 10 })).toEqual({ tasks: [task] });
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

  it("pages tasks newest first, even after the last task shown is deleted", async () => {
    const oldest = store.createTask("one");
    const middle = store.createTask("two");
    const newest = store.createTask("three");
    const first = store.listTasks({ limit: 1 });
    expect(first.tasks).toEqual([newest]);
    await store.deleteTask(newest.id);
    const rest = store.listTasks({ limit: 2, cursor: first.next ?? "" });
    expect(rest.tasks).toEqual([middle, oldest]);
  });

  // A query that loses its index reads the whole table and slows down with every event stored.
  it("answers every query through an index", () => {
    const db = openDatabase(join(directory, "store.db"));
    const plan = (sql: string) =>
      db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail))
        .join("\n");
    for (const [name, sql] of Object.entries(queries)) {
      expect(plan(sql), name).not.toMatch(/SCAN |TEMP B-TREE/);
    }
    // A range over the primary key is still a search, so these must name the index they rely on.
    const required: [string, string][] = [
      [queries.sessionEventsAfter, "events_by_session"],
      [queries.deleteSessionEvents, "events_by_session"],
      [queries.deleteSessionHarnessLines, "harness_lines_by_session"],
      [queries.sessionsOfTask, "sessions_by_task"],
      [queries.unfinishedSessions, "sessions_unfinished"],
      // The foreign-key checks SQLite runs when a session row is deleted with its task.
      ["DELETE FROM sessions WHERE ref = ?", "events_by_session"],
      ["DELETE FROM sessions WHERE ref = ?", "harness_lines_by_session"],
      ["DELETE FROM sessions WHERE ref = ?", "sessions_by_resumed_from"],
    ];
    for (const [sql, index] of required) expect(plan(sql)).toContain(index);
    db.close();
  });
});
