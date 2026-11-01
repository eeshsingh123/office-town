import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Change, SessionEvent, SessionEventBody, SessionOptions } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/store/database.ts";
import { migrations } from "../src/store/migrations.ts";
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
  it("ends a session that had finished its work as done at a restart, and repairs one already cut off", () => {
    const task = store.createTask("Write a report");
    const midTurn = startSession(task.id);
    midTurn.emit({ type: "turn.started", payload: { turnId: "turn-1" } });
    const finished = startSession(task.id);
    const turnEnded = { turnId: "turn-1", outcome: "completed" } as const;
    finished.emit({ type: "turn.started", payload: { turnId: "turn-1" } });
    finished.emit({ type: "turn.ended", payload: turnEnded });

    expect(store.markInterrupted().map((session) => session.id)).toEqual([midTurn.id]);
    expect(store.getSession(finished.id)?.status).toBe("exited");
    const [ended] = store
      .readEvents({ after: 0, limit: 100, sessionId: finished.id })
      .filter(({ event }) => event.type === "session.ended");
    expect(ended?.event.payload).toMatchObject({ reason: "exited", idle: true });

    midTurn.emit({ type: "turn.ended", payload: turnEnded });
    store.markInterrupted();
    expect(store.getSession(midTurn.id)?.status).toBe("exited");
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

  // Rewinding the version reruns every later migration, so each one must be rerunnable.
  it("reruns its migrations over existing data, turning every stored Trusted level into Full", () => {
    const agent = addAgent(store);
    const task = store.createTask("Edit the report");
    const session = startSession(task.id, { agentId: agent.id });
    session.emit({
      type: "permission.resolved",
      payload: { requestId: "r", outcome: "allowed", answeredBy: { autonomy: "full" } },
    });
    store.close();
    const old = new DatabaseSync(join(directory, "store.db"));
    old.exec(`
      UPDATE agents SET autonomy = 'trusted',
        settings = json_set(settings, '$.autonomy', 'trusted');
      UPDATE events SET payload = replace(payload, '"full"', '"trusted"');
      PRAGMA user_version = 11;
    `);
    old.close();

    store = openStore(directory);
    expect(store.getAgent(agent.id)).toMatchObject({
      autonomy: "full",
      settings: { autonomy: "full" },
    });
    const [resolved] = store.readEvents({ sessionId: session.id, after: 0, limit: 10 });
    expect(resolved?.event.payload).toMatchObject({ answeredBy: { autonomy: "full" } });
  });

  it("drops Scratch from a department that has a folder, and leaves one that has none", () => {
    const scratch = store.listWorkspaces().find((workspace) => workspace.kind === "scratch");
    if (scratch === undefined) throw new Error("Scratch always exists.");
    const folder = store.createWorkspace({
      name: "Site",
      kind: "folders",
      folders: [{ path: directory, access: "edit" }],
    });
    const departmentIn = (name: string, workspaceIds: string[]) =>
      store.createDepartment({
        name,
        workspaceIds,
        autonomy: "full",
        leadAgentId: addAgent(store).id,
        branchPerWorker: false,
        codeFlow: false,
      });
    const mixed = departmentIn("Mixed", [scratch.id, folder.id]);
    const empty = departmentIn("Empty", [scratch.id]);
    store.close();
    const old = new DatabaseSync(join(directory, "store.db"));
    old.exec(`PRAGMA user_version = ${migrations.length - 1};`);
    old.close();

    store = openStore(directory);
    expect(store.getDepartment(mixed.id)?.workspaceIds).toEqual([folder.id]);
    expect(store.getDepartment(empty.id)?.workspaceIds).toEqual([scratch.id]);
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
        accountId: "claude",
        harness: "claude",
        limits: [{ id: "five_hour", label: "5 hours", usedFraction: 0.3 }],
        reportedAt: expect.any(String),
      },
    ]);
    expect(changes.at(-2)).toEqual({ type: "task", task: store.getTask(task.id) });
    expect(changes.at(-1)).toEqual({ type: "limits", limits: store.listLimits()[0] });
  });

  // A query that loses its index reads the whole table and slows down with every event stored.
});
