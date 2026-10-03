import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionOptions } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PublishedEvent,
  SessionNotResumableError,
  SessionNotRunningError,
  SessionRegistry,
} from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
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
  const registry = new SessionRegistry(store, () => {
    const session = new FakeSession();
    sessions.push(session);
    return session;
  });
  registry.subscribe((event) => published.push(event));
  return registry;
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

    const record = await registry.start("Write a report", options);
    const [session] = sessions;
    session?.line('{"type":"stream_event"}', true);
    session?.line('{"type":"assistant"}');
    session?.emit({ type: "message.delta", payload: { text: "Done" } });
    session?.emit({ type: "message", payload: { role: "assistant", text: "Done" } });

    expect(session?.sent).toEqual([{ type: "start" }, { type: "prompt", text: "Write a report" }]);
    expect(record).toMatchObject({ status: "running", harnessSessionId: `harness-${record.id}` });
    expect(published.map(({ position, event }) => [event.type, position !== undefined])).toEqual([
      ["session.started", true],
      ["message.delta", false],
      ["message", true],
    ]);
    expect(storedWhenPublished).toEqual([true, true]);
    const audit = new DatabaseSync(join(directory, "store.db"), { readOnly: true });
    expect(audit.prepare("SELECT line FROM harness_lines").all()).toEqual([
      { line: '{"type":"assistant"}' },
    ]);
    audit.close();
  });

  it("leaves an unfinished session interrupted after a crash or a shutdown, and resumes it in its task", async () => {
    const first = await openRegistry().start("Write a report", options);

    // A new registry over the same store is what a core restarted after a crash sees.
    const registry = openRegistry();
    expect(store.getSession(first.id)?.status).toBe("interrupted");
    await expect(registry.send(first.id, { type: "prompt", text: "Hello?" })).rejects.toThrow(
      SessionNotRunningError,
    );

    const resumed = await registry.resume(first.id, "Continue where you left off");
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
    await expect(registry.resume(first.id, "Continue")).rejects.toThrow(SessionNotResumableError);

    await registry.close();
    expect(sessions[1]?.sent.at(-1)).toEqual({ type: "stop" });
    expect(store.getSession(resumed.id)?.status).toBe("interrupted");
  });

  it("stops an agent whose work can no longer be saved, says why, and saves its end once it can", async () => {
    const registry = openRegistry();
    const record = await registry.start("Write a report", options);
    vi.spyOn(store, "append").mockImplementationOnce(() => {
      throw new Error("database or disk is full");
    });

    sessions[0]?.emit({ type: "message", payload: { role: "assistant", text: "Done" } });

    expect(published.slice(1).map(({ event }) => event.type)).toEqual([
      "message",
      "error",
      "session.ended",
    ]);
    expect(published[2]?.event.payload).toEqual({
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
    expect(published[3]?.position).toBeDefined();
    expect(store.getSession(record.id)?.status).toBe("failed");
    await store.deleteTask(record.taskId);
  });
});
