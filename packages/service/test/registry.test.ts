import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionOptions } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnswerError,
  type PublishedEvent,
  SessionNotResumableError,
  SessionNotRunningError,
  SessionRegistry,
} from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { addAgent } from "./support/agents.ts";
import { FakeSession } from "./support/fake-session.ts";

const options: SessionOptions = {
  harness: "claude",
  environment: { kind: "native" },
  permissionMode: "ask",
};

let directory: string;
let store: Store;
let sessions: FakeSession[];
let published: PublishedEvent[];

function openRegistry(): SessionRegistry {
  const registry = new SessionRegistry(store, {
    createSession: () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    },
  });
  registry.subscribe((event) => published.push(event));
  return registry;
}

function start(registry: SessionRegistry, prompt: string) {
  const task = store.createTask(prompt);
  const agent = addAgent(store);
  return registry.start({ taskId: task.id, agentId: agent.id, options, message: { text: prompt } });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "office-town-registry-"));
  store = openStore(directory);
  sessions = [];
  published = [];
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("session registry", () => {
  it("stores every event before publishing it, and stores no text fragment or partial line", async () => {
    const registry = openRegistry();
    const storedWhenPublished: boolean[] = [];
    registry.subscribe(({ position, event }) => {
      if (position === undefined) return;
      const [stored] = store.readEvents({ after: position - 1, limit: 1 });
      storedWhenPublished.push(stored?.event.id === event.id);
    });

    const record = await start(registry, "Write a report");
    const [session] = sessions;
    session?.line('{"type":"stream_event"}', true);
    session?.line('{"type":"assistant"}');
    session?.emit({ type: "message.delta", payload: { text: "Done" } });
    session?.emit({ type: "message", payload: { role: "assistant", text: "Done" } });

    expect(session?.sent).toEqual([{ type: "start" }, { type: "prompt", text: "Write a report" }]);
    expect(record).toMatchObject({ status: "running", harnessSessionId: `harness-${record.id}` });
    expect(published.map(({ position, event }) => [event.type, position !== undefined])).toEqual([
      ["session.started", true],
      ["message", true],
      ["message.delta", false],
      ["message", true],
    ]);
    expect(storedWhenPublished).toEqual([true, true, true]);
    // The store holds its file alone, so the audit copy is read once it is closed.
    await registry.close();
    store.close();
    const audit = new DatabaseSync(join(directory, "store.db"), { readOnly: true });
    expect(audit.prepare("SELECT line FROM harness_lines").all()).toEqual([
      { line: '{"type":"assistant"}' },
    ]);
    audit.close();
    store = openStore(directory);
  });

  it("leaves an unfinished session interrupted after a crash or a shutdown, and resumes it in its task", async () => {
    const first = await start(openRegistry(), "Write a report");

    // A new registry over the same store is what a core restarted after a crash sees.
    const registry = openRegistry();
    expect(store.getSession(first.id)?.status).toBe("interrupted");
    await expect(registry.send(first.id, { type: "prompt", text: "Hello?" })).rejects.toThrow(
      SessionNotRunningError,
    );

    const resumed = await registry.resume(first.id, { text: "Continue where you left off" });
    expect(resumed).toMatchObject({
      taskId: first.taskId,
      resumedFrom: first.id,
      status: "running",
      options: { ...options, resumeSessionId: first.harnessSessionId },
    });
    expect(sessions[1]?.sent.at(-1)).toEqual({
      type: "prompt",
      text: "Continue where you left off",
    });
    await expect(registry.resume(first.id, { text: "Continue" })).rejects.toThrow(
      SessionNotResumableError,
    );

    await registry.close();
    expect(sessions[1]?.sent.at(-1)).toEqual({ type: "stop" });
    expect(store.getSession(resumed.id)?.status).toBe("interrupted");
  });

  it("stops an agent whose work can no longer be saved, says why, and saves its end once it can", async () => {
    const registry = openRegistry();
    const record = await start(registry, "Write a report");
    vi.spyOn(store, "append").mockImplementationOnce(() => {
      throw new Error("database or disk is full");
    });

    sessions[0]?.emit({ type: "message", payload: { role: "assistant", text: "Done" } });

    expect(published.slice(2).map(({ event }) => event.type)).toEqual([
      "message",
      "error",
      "session.ended",
    ]);
    expect(published[3]?.event.payload).toEqual({
      message:
        "This agent's work could not be saved, so the agent was stopped. " +
        "Nothing it does from here on is in its history.",
      detail: "database or disk is full",
      fatal: true,
    });
    expect(sessions[0]?.sent.at(-1)).toEqual({ type: "stop" });
    await expect(registry.send(record.id, { type: "prompt", text: "Hello?" })).rejects.toThrow(
      SessionNotRunningError,
    );
    expect(published[4]?.position).toBeDefined();
    expect(store.getSession(record.id)?.status).toBe("failed");
    await store.deleteTask(record.taskId);
  });

  it("offers no 'always allow' to an agent with a read-only folder, and takes no answer it was not offered", async () => {
    const registry = openRegistry();
    const task = store.createTask("Build on the API");
    const upstream = join(directory, "api");
    await registry.start({
      taskId: task.id,
      agentId: addAgent(store).id,
      options: { ...options, additionalPaths: [upstream], readOnlyPaths: [upstream] },
      message: { text: "Build on the API" },
    });

    sessions[0]?.emit({
      type: "permission.requested",
      payload: {
        requestId: "edit",
        title: "Edit",
        input: {},
        options: [
          { optionId: "once", label: "Allow", kind: "allow_once" },
          { optionId: "always", label: "Always allow", kind: "allow_always" },
          { optionId: "no", label: "Reject", kind: "reject_once" },
        ],
      },
    });

    const [waiting] = store.listPendingRequests().requests;
    expect(waiting?.event.payload).toMatchObject({
      options: [{ optionId: "once" }, { optionId: "no" }],
    });
    const answer = (optionId: string) =>
      registry.send(sessions[0]?.id ?? "", {
        type: "answerPermission",
        requestId: "edit",
        optionId,
      });
    await expect(answer("always")).rejects.toThrow(AnswerError);
    await answer("once");
    expect(sessions[0]?.sent.at(-1)).toMatchObject({ optionId: "once" });
    await registry.close();
  });
});
