import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type SessionEvent,
  type SessionOptions,
  sessionRecordSchema,
  taskDetailSchema,
  workspaceRecordSchema,
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

function startTask(prompt: string): Promise<Response> {
  return call("POST", "/tasks", { prompt, options, outputFolder: directory });
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
    const started = await startTask("Write a report");
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

  it("starts a task in a saved workspace, or in a new folder inside the remembered output folder", async () => {
    const start = (request: object) =>
      call("POST", "/tasks", { prompt: "Write: a report?", options, ...request });
    const workspaceOf = async (response: Response) =>
      sessionRecordSchema.parse(await response.json()).options;
    const project = join(directory, "project");
    const notes = join(directory, "notes");
    mkdirSync(project);
    mkdirSync(notes);

    expect((await start({})).status).toBe(400);
    const missing = { name: "Gone", folders: [join(directory, "gone")] };
    expect((await call("POST", "/workspaces", missing)).status).toBe(400);
    const created = await call("POST", "/workspaces", {
      name: "Report",
      folders: [project, notes],
    });
    const workspace = workspaceRecordSchema.parse(await created.json());
    expect(await workspaceOf(await start({ workspaceId: workspace.id }))).toMatchObject({
      workspacePath: project,
      additionalPaths: [notes],
    });

    const first = await workspaceOf(await start({ outputFolder: directory }));
    const second = await workspaceOf(await start({}));
    expect(dirname(first.workspacePath ?? "")).toBe(directory);
    expect(first.workspacePath).toMatch(/\d{4}-\d{2}-\d{2} Write a report$/);
    expect(second.workspacePath).toBe(`${first.workspacePath} (2)`);
    expect(existsSync(second.workspacePath ?? "")).toBe(true);
    expect(await (await call("GET", "/settings")).json()).toEqual({ outputFolder: directory });
  });

  it("replays stored events by position and continues live, with no gap or repeat, or ends when not following", async () => {
    const started = await startTask("Write a report");
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

    // A replay that does not follow ends once it has sent every stored event.
    const replay = await (await call("GET", `/events?session=${session.id}&follow=false`)).text();
    expect(replay.match(/^id: \d+$/gm)).toEqual(["id: 1", "id: 2", "id: 3", "id: 4", "id: 5"]);
  });
});
