import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type SessionEvent,
  sessionRecordSchema,
  workspaceRecordSchema,
  workspaceUsageSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiServer, startApiServer } from "../src/api/server.ts";
import { ConnectorHub } from "../src/connectors/hub.ts";
import { PreviewServer } from "../src/outputs/preview-server.ts";
import { TaskFiles } from "../src/outputs/task-files.ts";
import { SessionRegistry } from "../src/registry/session-registry.ts";
import { openStore } from "../src/store/sqlite-store.ts";
import type { Store } from "../src/store/store.ts";
import { cachedCatalogs } from "../src/team/catalogs.ts";
import { Checks } from "../src/team/checks.ts";
import { TaskStates } from "../src/team/task-state.ts";
import { UsagePauses } from "../src/team/usage-pause.ts";
import { memorySecrets } from "./support/connectors.ts";
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
let preview: PreviewServer;
let sessions: FakeSession[];
let scratchId: string;
const streams: AbortController[] = [];

function call(method: string, path: string, body?: unknown, token = TOKEN): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function startTask(prompt: string): Promise<Response> {
  return call("POST", "/tasks", { prompt, ...newTask, workspaceId: scratchId });
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
  scratchId = store.createWorkspace({
    name: "Scratch",
    kind: "scratch",
    folders: [{ path: directory, access: "edit" }],
  }).id;
  const taskStates = new TaskStates(store);
  sessions = [];
  const createSession = () => {
    const session = new FakeSession();
    sessions.push(session);
    return session;
  };
  registry = new SessionRegistry(store, {
    createSession,
    seesImages: async (options) => options.model === "sees-images",
  });
  taskStates.follow(registry);
  const readCatalog = cachedCatalogs(async () => ({ models: [] }));
  const team = { registry, store, readCatalog, dataFolder: directory, createSession };
  const connectors = new ConnectorHub(store, registry, memorySecrets());
  const pauses = new UsagePauses(team);
  const checks = new Checks(team);
  preview = await PreviewServer.start();
  const outputs = { preview, files: new TaskFiles(store), ownPorts: new Set<number>() };
  server = await startApiServer({
    team,
    connectors,
    pauses,
    checks,
    outputs,
    token: TOKEN,
    port: 0,
  });
});

afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await server.close();
  await preview.close();
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

  it("starts a task in its workspace, a new folder per task in Scratch, keeps folder access, counts the use, and resumes only where it started", async () => {
    const start = (workspaceId: string) =>
      call("POST", "/tasks", { prompt: "Write: a report?", ...newTask, workspaceId });
    const optionsOf = async (response: Response) =>
      sessionRecordSchema.parse(await response.json()).options;
    const project = join(directory, "project");
    const notes = join(directory, "notes");
    mkdirSync(project);
    mkdirSync(notes);

    expect((await call("POST", "/tasks", { prompt: "Write", ...newTask })).status).toBe(400);
    const gone = [{ path: join(directory, "gone"), access: "edit" }];
    expect(
      (await call("POST", "/workspaces", { name: "Gone", kind: "folders", folders: gone })).status,
    ).toBe(400);
    const created = await call("POST", "/workspaces", {
      name: "Report",
      kind: "folders",
      folders: [
        { path: project, access: "edit" },
        { path: notes, access: "read" },
      ],
    });
    const workspace = workspaceRecordSchema.parse(await created.json());
    expect(await optionsOf(await start(workspace.id))).toMatchObject({
      workspacePath: project,
      additionalPaths: [notes],
      readOnlyPaths: [notes],
    });

    const first = await optionsOf(await start(scratchId));
    const second = await optionsOf(await start(scratchId));
    expect(dirname(first.workspacePath ?? "")).toBe(directory);
    expect(first.workspacePath).toMatch(/\d{4}-\d{2}-\d{2} \d{2}-\d{2} [0-9a-f]{8}$/);
    expect(second.workspacePath).not.toBe(first.workspacePath);
    expect(existsSync(second.workspacePath ?? "")).toBe(true);

    const usage = workspaceUsageSchema
      .array()
      .parse(await (await call("GET", "/workspaces/usage")).json());
    expect(usage.find((each) => each.workspaceId === scratchId)).toMatchObject({
      taskCount: 2,
      missingFolders: [],
    });

    // A resume runs where the session started, so a folder removed since is reported as such.
    const ended = sessionRecordSchema.parse(await (await start(scratchId)).json());
    await call("POST", `/sessions/${ended.id}/stop`);
    rmSync(ended.options.workspacePath ?? "", { recursive: true });
    const resumed = await call("POST", `/sessions/${ended.id}/resume`, { prompt: "Go on" });
    expect(resumed.status).toBe(400);
    expect(await resumed.json()).toMatchObject({
      message: expect.stringContaining("does not exist"),
    });
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
});
