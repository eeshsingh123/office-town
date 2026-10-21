import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Audience,
  type ConnectorPermission,
  type ConnectorRecord,
  defaultAccountId,
  type SessionRecord,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decide } from "../src/connectors/access.ts";
import { type NotesApp, startNotesApp } from "./support/notes-app.ts";
import { type Core, settle, startCore } from "./support/team-core.ts";

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

const pending = () =>
  core.store
    .listPendingRequests()
    .requests.map(({ event }) => event)
    .filter((event) => event.type === "permission.requested");

describe("connectors", () => {
  it("reads always, and a change asks, is refused or goes through by the connector's own setting", () => {
    for (const permission of ["read_only", "ask", "dont_ask"] as const) {
      expect(decide(permission, true)).toBe("go");
    }
    expect(decide("read_only", false)).toBe("refuse");
    expect(decide("ask", false)).toBe("ask");
    expect(decide("dont_ask", false)).toBe("go");
  });

  // D-68: Claude Code connects Claude apps itself; the core picks who gets them and decides calls.
  it("gives Claude apps to Claude agents only and decides each call by the app's permission", async () => {
    core.store.createConnector({
      setup: {
        slug: "claude-notion",
        name: "Notion",
        kind: "claude",
        official: true,
        account: defaultAccountId("claude", { kind: "native" }),
        app: "claude.ai Notion",
        auth: "none",
        keys: [],
      },
      audience: everyone,
      permission: "ask",
      status: "connected",
      tools: [
        { name: "search", inputSchema: {}, annotations: { readOnlyHint: true } },
        { name: "create_page", inputSchema: {}, annotations: { readOnlyHint: false } },
      ],
    });
    const { record, session } = await startAgent();
    expect(record.options.vendorApps).toEqual(["claude.ai Notion"]);
    for (const [requestId, name] of [
      ["read", "search"],
      ["change", "create_page"],
    ] as const) {
      session?.emit({
        type: "permission.requested",
        payload: {
          requestId,
          title: name,
          input: {},
          kind: "other",
          tool: { server: "claude.ai Notion", name },
          options: [
            { optionId: "allow", label: "Allow", kind: "allow_once" },
            { optionId: "deny", label: "Deny", kind: "reject_once" },
          ],
        },
      });
    }
    await settle();
    expect(session?.sent).toContainEqual({
      type: "answerPermission",
      requestId: "read",
      optionId: "allow",
      answeredBy: "app",
    });
    expect(pending().map(({ payload }) => payload.requestId)).toEqual(["change"]);

    const other = await core.call("POST", "/tasks", {
      prompt: "Look up the pricing",
      agent: { settings: { harness: "opencode", environment: { kind: "native" } } },
      autonomy: "supervised",
      workspaceId,
    });
    expect((other.json as SessionRecord).options.vendorApps).toBeUndefined();
  });

  it("keeps keys out of SQLite and out of what a harness is launched with", async () => {
    await connect("notes", "ask");
    const { record, session } = await startAgent();
    await core.callTool(session, "search_notes", { query: "Pricing" }, "notes");
    const stored = ["store.db", "store.db-wal"]
      .map((name) => join(directory, "data", name))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file).toString("latin1"));
    expect(stored.join("")).not.toContain(KEY);
    expect(JSON.stringify([record.options, session?.extras])).not.toContain(KEY);
    expect([...core.secrets.values.values()].join("")).toContain(KEY);
  });
});
