import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Audience,
  appKeyOf,
  type ConnectorPermission,
  type ConnectorRecord,
  type SessionRecord,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decide } from "../src/connectors/access.ts";
import { type NotesApp, startNotesApp } from "./support/notes-app.ts";
import { type Core, eventually, startCore } from "./support/team-core.ts";

const KEY = "notes-key-1234";
const everyone: Audience = { everyone: true, departmentIds: [], agentIds: [] };

let directory: string;
let core: Core;
let app: NotesApp;
let workspaceId: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-connectors-"));
  core = await startCore(join(directory, "data"));
  app = await startNotesApp(0, KEY);
  workspaceId = core.store.createWorkspace({
    name: "Scratch",
    kind: "scratch",
    folders: [{ path: directory, access: "edit" }],
  }).id;
});

afterEach(async () => {
  await core.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

// Given to another agent only, so the one under test has no access.
async function connect(slug: string, permission: ConnectorPermission, audience = everyone) {
  const reply = await core.call("POST", "/connectors", {
    setup: {
      slug,
      name: `Notes ${slug}`,
      kind: "remote",
      official: false,
      url: app.url,
      auth: "key",
      keys: [{ name: "Authorization", label: "Key" }],
    },
    audience,
    permission,
    keys: { Authorization: KEY },
  });
  expect(reply.status).toBe(201);
  return reply.json as ConnectorRecord;
}

async function startAgent() {
  const reply = await core.call("POST", "/tasks", {
    prompt: "Look up the pricing",
    agent: { settings: { harness: "claude", environment: { kind: "native" } } },
    autonomy: "supervised",
    workspaceId,
  });
  const record = reply.json as SessionRecord;
  return { record, session: core.sessions.find(({ id }) => id === record.id) };
}

describe("connectors", () => {
  it("reads always, and a change asks, is refused or goes through by the connector's own setting or an automation's, with its key kept out of SQLite and launches", async () => {
    for (const permission of ["read_only", "ask", "dont_ask"] as const) {
      expect(decide(permission, true)).toBe("go");
    }
    expect(decide("read_only", false)).toBe("refuse");
    expect(decide("ask", false)).toBe("ask");
    expect(decide("dont_ask", false)).toBe("go");

    // D-129: only inside the runs of an automation that lets this app act without asking.
    await connect("notes", "ask");
    const created = await core.call("POST", "/automations", {
      name: "Nightly notes",
      task: {
        kind: "assistant",
        request: {
          prompt: "Save a note on today's pricing.",
          agent: { settings: { harness: "claude", environment: { kind: "native" } } },
          autonomy: "supervised",
          workspaceId,
        },
      },
      trigger: { kind: "schedule", schedule: { repeat: "daily", time: "09:00" }, timeZone: "UTC" },
      rules: { appsWithoutAsking: [appKeyOf("Notes notes")] },
    });
    expect(created.status).toBe(201);
    expect((await core.call("POST", `/automations/${created.json.id}/run`)).status).toBe(201);
    const runSession = () =>
      core.sessions.find(
        ({ id }) =>
          core.store.getTask(core.store.getSession(id)?.taskId ?? "")?.origin?.kind ===
          "automation",
      );
    await eventually(() => runSession() !== undefined);
    const saved = await core.callTool(
      runSession(),
      "create_note",
      { text: "From the run" },
      "notes",
    );
    expect(saved.text).toContain("Saved note");
    expect(app.notes).toContain("From the run");

    const { record, session } = await startAgent();
    const asked = await core.callTool(session, "create_note", { text: "From you" }, "notes");
    expect(asked.text).toContain("waits for the user's OK");
    expect(app.notes).not.toContain("From you");

    // Keys stay out of SQLite and out of what a harness is launched with (D-67).
    const stored = ["store.db", "store.db-wal"]
      .map((name) => join(directory, "data", name))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file).toString("latin1"));
    expect(stored.join("")).not.toContain(KEY);
    expect(JSON.stringify([record.options, session?.extras])).not.toContain(KEY);
    expect([...core.secrets.values.values()].join("")).toContain(KEY);
  });
});
