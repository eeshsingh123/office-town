import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionEvent,
  type SessionOptions,
  sessionRecordSchema,
  taskDetailSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiServer, startApiServer } from "../src/api/server.ts";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { FakeSession } from "./support/fake-session.ts";

const TOKEN = "test-token";
const options: SessionOptions = {
  harness: "claude",
  environment: { kind: "native" },
  permissionMode: "ask",
};

interface Frame {
  id: string | undefined;
  event: SessionEvent;
}

let directory: string;
let store: Store;
let registry: SessionRegistry;
let server: ApiServer;
let sessions: FakeSession[];
const streams: AbortController[] = [];

function call(method: string, path: string, body?: unknown, token = TOKEN): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function openStream(path: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  streams.push(controller);
  const response = await fetch(`${server.url}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    signal: controller.signal,
  });
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return async (count: number): Promise<Frame[]> => {
    const frames: Frame[] = [];
    while (frames.length < count) {
      const end = buffer.indexOf("\n\n");
      if (end === -1) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done) throw new Error("The stream ended.");
        buffer += chunk.value;
        continue;
      }
      const fields = new Map(
        buffer
          .slice(0, end)
          .split("\n")
          .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
      );
      buffer = buffer.slice(end + 2);
      frames.push({ id: fields.get("id"), event: JSON.parse(fields.get("data") ?? "") });
    }
    return frames;
  };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-api-"));
  store = openStore(directory);
  sessions = [];
  registry = new SessionRegistry(store, () => {
    const session = new FakeSession();
    sessions.push(session);
    return session;
  });
  server = await startApiServer({ registry, store, token: TOKEN, port: 0 });
});

afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await server.close();
  await registry.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("api", () => {
  it("refuses every request without the launch token", async () => {
    for (const [path, token] of [
      ["/tasks", "wrong"],
      ["/events", "wrong"],
      ["/tasks", ""],
    ] as const) {
      const response = await call("GET", path, undefined, token);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "unauthorized" });
    }
  });

  it("runs a session through its commands and answers misuse with the matching status", async () => {
    const started = await call("POST", "/tasks", { prompt: "Write a report", options });
    expect(started.status).toBe(201);
    const session = sessionRecordSchema.parse(await started.json());
    expect(session).toMatchObject({ status: "running" });
    const commands = `/sessions/${session.id}/commands`;

    expect((await call("POST", commands, { type: "prompt", text: "More" })).status).toBe(204);
    expect(sessions[0]?.sent.at(-1)).toEqual({ type: "prompt", text: "More" });
    expect((await call("POST", commands, { type: "stop" })).status).toBe(400);
    expect((await call("POST", "/tasks", { prompt: "", options })).status).toBe(400);

    const detail = taskDetailSchema.parse(
      await (await call("GET", `/tasks/${session.taskId}`)).json(),
    );
    expect(detail.sessions.map(({ id }) => id)).toEqual([session.id]);
    expect((await call("DELETE", `/tasks/${session.taskId}`)).status).toBe(409);

    expect((await call("POST", `/sessions/${session.id}/stop`)).status).toBe(204);
    expect((await call("POST", commands, { type: "interrupt" })).status).toBe(409);
    expect((await call("GET", "/sessions/unknown")).status).toBe(404);
    expect((await call("DELETE", `/tasks/${session.taskId}`)).status).toBe(204);
  });

  it("replays stored events by position and continues live, with no gap or repeat", async () => {
    const started = await call("POST", "/tasks", { prompt: "Write a report", options });
    const session = sessionRecordSchema.parse(await started.json());
    const agent = sessions[0];
    agent?.emit({ type: "message", payload: { role: "assistant", text: "First" } });

    const live = await openStream("/events?after=0");
    expect((await live(2)).map(({ id, event }) => [id, event.type])).toEqual([
      ["1", "session.started"],
      ["2", "message"],
    ]);

    // One event is stored before the replay reads the store and one after it: each arrives once.
    const readEvents = store.readEvents.bind(store);
    vi.spyOn(store, "readEvents").mockImplementationOnce((query) => {
      agent?.emit({ type: "message", payload: { role: "assistant", text: "Before" } });
      const page = readEvents(query);
      agent?.emit({ type: "message", payload: { role: "assistant", text: "After" } });
      return page;
    });
    const resumed = await openStream(`/events?session=${session.id}`, { "last-event-id": "1" });
    agent?.emit({ type: "message.delta", payload: { text: "Liv" } });
    agent?.emit({ type: "message", payload: { role: "assistant", text: "Live" } });

    const frames = await resumed(5);
    expect(frames.map(({ id, event }) => [id, event.type])).toEqual([
      ["2", "message"],
      ["3", "message"],
      ["4", "message"],
      [undefined, "message.delta"],
      ["5", "message"],
    ]);
    expect(frames.map(({ event }) => event.payload)).toMatchObject([
      { text: "First" },
      { text: "Before" },
      { text: "After" },
      { text: "Liv" },
      { text: "Live" },
    ]);
  });
});
