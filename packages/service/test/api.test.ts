import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  agentRecordSchema,
  changeSchema,
  profileRecordSchema,
  type SessionEvent,
  sessionRecordSchema,
  taskDetailSchema,
  workspaceRecordSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiServer, startApiServer } from "../src/api/server.ts";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { cachedCatalogs } from "../src/team/catalogs.ts";
import { TaskStates } from "../src/team/task-state.ts";
import { FakeSession } from "./support/fake-session.ts";

const TOKEN = "test-token";
const settings = { harness: "claude", environment: { kind: "native" } };
const newTask = { agent: { settings }, autonomy: "supervised" };

// A change frame is named "change" and carries a record change instead of an event.
interface Frame {
  id: string | undefined;
  name: string | undefined;
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
  return call("POST", "/tasks", { prompt, ...newTask, outputFolder: directory });
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
      frames.push({
        id: fields.get("id"),
        name: fields.get("event"),
        event: JSON.parse(fields.get("data") ?? ""),
      });
    }
    return frames;
  };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-api-"));
  store = openStore(directory);
  const taskStates = new TaskStates(store);
  sessions = [];
  registry = new SessionRegistry(store, {
    createSession: () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    },
  });
  taskStates.follow(registry);
  const readCatalog = cachedCatalogs(async () => ({ models: [] }));
  const team = { registry, store, readCatalog, dataFolder: directory };
  server = await startApiServer({ team, token: TOKEN, port: 0 });
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
    expect((await call("POST", "/tasks", { prompt: "", ...newTask })).status).toBe(400);

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

  it("starts a task in a saved workspace or a new folder in the remembered output folder, and resumes only where it started", async () => {
    const start = (request: object) =>
      call("POST", "/tasks", { prompt: "Write: a report?", ...newTask, ...request });
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

    // A resume runs where the session started, so a folder removed since is reported as such.
    const ended = sessionRecordSchema.parse(await (await start({})).json());
    await call("POST", `/sessions/${ended.id}/stop`);
    rmSync(ended.options.workspacePath ?? "", { recursive: true });
    const resumed = await call("POST", `/sessions/${ended.id}/resume`, { prompt: "Go on" });
    expect(resumed.status).toBe(400);
    expect(await resumed.json()).toMatchObject({
      message: expect.stringContaining("does not exist"),
    });
  });

  it("gives each task's agent a free name, follows its profile, and refuses a name in use", async () => {
    const profile = profileRecordSchema.parse(
      await (
        await call("POST", "/profiles", {
          name: "Copywriter",
          role: "Writes the words",
          colour: "#6553AE",
          settings: { ...settings, model: "haiku", instructions: "Write plainly." },
        })
      ).json(),
    );
    const fromProfile = sessionRecordSchema.parse(
      await (
        await call("POST", "/tasks", {
          prompt: "Write the menu",
          agent: { profileId: profile.id },
          autonomy: "supervised",
          outputFolder: directory,
        })
      ).json(),
    );
    expect(fromProfile.options.model).toBe("haiku");
    expect(sessions[0]?.sent[1]).toMatchObject({
      text: "Write plainly.\n\nYour task:\nWrite the menu",
      origin: { kind: "brief" },
    });
    const solo = sessionRecordSchema.parse(await (await startTask("Write a report")).json());
    const agents = agentRecordSchema.array().parse(await (await call("GET", "/agents")).json());
    expect(agents.map(({ id, role, colour }) => [id, role, colour])).toEqual([
      [fromProfile.agentId, "Copywriter", "#6553AE"],
      [solo.agentId, undefined, expect.any(String)],
    ]);

    const taken = agents[0]?.name;
    const rename = (name: string | undefined) =>
      call("PUT", `/agents/${solo.agentId}/name`, { name });
    expect((await rename(taken)).status).toBe(409);
    expect((await rename("Ben")).status).toBe(400);
    expect(await (await rename("@ben")).json()).toMatchObject({ name: "@ben" });

    // A deleted profile leaves its agents working with the settings they were made with.
    expect((await call("DELETE", `/profiles/${profile.id}`)).status).toBe(204);
    const kept = agentRecordSchema.parse(
      await (await call("GET", `/agents/${fromProfile.agentId}`)).json(),
    );
    expect(kept.profileId).toBeUndefined();
    expect(kept.settings.model).toBe("haiku");

    await call("POST", `/sessions/${solo.id}/stop`);
    expect((await call("DELETE", `/tasks/${solo.taskId}`)).status).toBe(204);
    expect((await call("GET", `/agents/${solo.agentId}`)).status).toBe(404);
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
    const resumed = await openStream(`/events?session=${session.id}`, { "last-event-id": "2" });
    agent?.emit({ type: "message.delta", payload: { text: "Liv" } });
    agent?.emit({ type: "message", payload: { role: "assistant", text: "Live" } });

    const frames = await resumed(5);
    expect(frames.map(({ id, event }) => [id, event.type])).toEqual([
      ["3", "message"],
      ["4", "message"],
      ["5", "message"],
      [undefined, "message.delta"],
      ["6", "message"],
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
    expect(replay.match(/^id: \d+$/gm)).toEqual([
      "id: 1",
      "id: 2",
      "id: 3",
      "id: 4",
      "id: 5",
      "id: 6",
    ]);
  });

  it("sends record changes live on the stream of every session only, never on a replay", async () => {
    const started = await startTask("Write a report");
    const session = sessionRecordSchema.parse(await started.json());
    const everything = await openStream("/events?after=0");
    const oneSession = await openStream(`/events?session=${session.id}&after=0`);
    sessions[0]?.emit({ type: "turn.started", payload: { turnId: "1" } });
    sessions[0]?.emit({
      type: "turn.ended",
      payload: { turnId: "1", outcome: "completed", usage: { inputTokens: 9, outputTokens: 1 } },
    });

    // The turn adds to the task's usage, and ends the goal.
    const frames = await everything(6);
    expect(frames.map(({ id, name, event }) => [id, name, event.type])).toEqual([
      ["1", undefined, "session.started"],
      ["2", undefined, "message"],
      ["3", undefined, "turn.started"],
      [undefined, "change", "task"],
      [undefined, "change", "task"],
      ["4", undefined, "turn.ended"],
    ]);
    expect(changeSchema.parse(frames[4]?.event)).toMatchObject({
      task: { state: "ended", usage: [{ harness: "claude", inputTokens: 9 }] },
    });
    expect((await oneSession(4)).map(({ event }) => event.type)).toEqual([
      "session.started",
      "message",
      "turn.started",
      "turn.ended",
    ]);
    const replay = await (await call("GET", "/events?follow=false")).text();
    expect(replay).not.toContain("event: change");
  });

  it("marks only a finished goal reviewed, and clears the review when the goal is taken up again", async () => {
    const started = sessionRecordSchema.parse(await (await startTask("Write a report")).json());
    const reviewed = `/tasks/${started.taskId}/reviewed`;
    expect((await call("POST", reviewed)).status).toBe(409);

    sessions[0]?.emit({ type: "turn.started", payload: { turnId: "1" } });
    sessions[0]?.emit({ type: "turn.ended", payload: { turnId: "1", outcome: "completed" } });
    const marked = await call("POST", reviewed);
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({ state: "ended", reviewedAt: expect.any(String) });

    sessions[0]?.emit({ type: "turn.started", payload: { turnId: "2" } });
    expect(store.getTask(started.taskId)).toMatchObject({ state: "working" });
    expect(store.getTask(started.taskId)?.reviewedAt).toBeUndefined();
  });

  it("keeps a dragged room's position in the settings until it is reset", async () => {
    expect((await call("PUT", "/room-positions/chief", { x: 12.5, y: 40 })).status).toBe(400);
    expect((await call("PUT", "/room-positions/chief", { x: 120, y: 40 })).status).toBe(204);
    expect((await call("PUT", "/room-positions/web", { x: 0, y: 300 })).status).toBe(204);
    expect((await call("DELETE", "/room-positions/web")).status).toBe(204);
    expect(await (await call("GET", "/settings")).json()).toEqual({
      roomPositions: { chief: { x: 120, y: 40 } },
    });
  });
});
