import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "../src/adapters/opencode/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replay, replayOptions } from "./support/replay.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", "opencode", name);
const recording = (name: string) => loadRecording(fixture(`${name}.jsonl`));

const recordings = {
  "write-allowed": recording("write-allowed"),
  "write-denied": recording("write-denied"),
  "plan-and-subagent": recording("plan-and-subagent"),
  "two-turns": recording("two-turns"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "team-tool": recording("team-tool"),
  // OpenCode 2 (D-97, D-98).
  "team-tool-2": recording("team-tool-2"),
  "features-2": recording("features-2"),
  "subagent-2": recording("subagent-2"),
};

describeAdapterConformance(opencodeAdapter, recordings);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

function configOf(options: Parameters<typeof opencodeAdapter.buildCommand>[0]) {
  const command = opencodeAdapter.buildCommand(options);
  return JSON.parse(command.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
}

describe("opencode adapter", () => {
  it("attaches the core's tool servers, keeps their tokens out of the reported lines, reports calls to them as theirs on OpenCode 1 and 2, and uses what OpenCode 2 adds", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const attached = {
      transport: "http" as const,
      name: "office-town",
      token: "secret",
      url: toolServer.url,
      headers: { Authorization: "Bearer secret" },
    };
    const config = configOf({ ...replayOptions, toolServers: [attached], blockedApps: ["rea"] });
    // Code Mode off, so OpenCode 2 calls each tool by its name; a blocked server is off on both.
    expect(config.permission).toMatchObject({ "office-town_*": "allow", execute: "deny" });
    expect(config.mcp).toEqual({ rea: { enabled: false } });
    expect(config.policies).toEqual([{ action: "mcp.use", resource: "rea", effect: "deny" }]);

    const { events, written, lines } = await replay(
      opencodeAdapter,
      recordings["team-tool"],
      replayOptions,
      { toolServers: [toolServer] },
    );
    const opened = JSON.parse(written[1] ?? "");
    expect(opened.method).toBe("session/new");
    expect(opened.params.mcpServers).toEqual([
      {
        type: "http",
        name: "office-town",
        url: toolServer.url,
        headers: [{ name: "Authorization", value: "Bearer secret" }],
      },
    ]);
    // The token reaches the harness, never the lines the core stores.
    expect(lines.map((line) => line.text).join("\n")).not.toContain("secret");
    expect(only(events, "action.started").map((event) => event.payload.tool)).toEqual([
      { server: "office-town", name: "ask_user" },
    ]);

    const second = await replay(opencodeAdapter, recordings["team-tool-2"], replayOptions, {
      toolServers: [toolServer],
    });
    expect(only(second.events, "action.started").map((event) => event.payload.tool)).toEqual([
      { server: "office-town", name: "search_notes" },
    ]);

    // OpenCode 2 (D-98): a waiting message steered into the turn, script and sub-agent steps
    // nested, its questions asked in Needs you, and Code Mode kept to shared apps.
    const opencode2 = opencodeAdapter.forVersion?.("2.3.0") ?? opencodeAdapter;
    const app = { name: "notes-x", url: "http://127.0.0.1:1/apps/notes-x", token: "secret" };
    const team = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const http = { transport: "http" as const, token: "secret", headers: {} };
    const servers = [
      { ...http, name: team.name, url: team.url },
      { ...http, name: app.name, url: app.url },
    ];
    const config2 = (options: Parameters<typeof opencode2.buildCommand>[0]) =>
      JSON.parse(opencode2.buildCommand(options).env?.OPENCODE_CONFIG_CONTENT ?? "{}");
    // The team server goes in the config, out of Code Mode; the user's own servers turn it off.
    const shared = config2({ ...replayOptions, toolServers: servers });
    expect(shared.permission.execute).toBeUndefined();
    expect(shared.mcp).toEqual({
      "office-town": { type: "remote", url: team.url, headers: {}, oauth: false, codemode: false },
    });
    const own = config2({ ...replayOptions, toolServers: servers, vendorApps: ["rea"] });
    expect(own.permission.execute).toBe("deny");
    expect(own.mcp).toBeUndefined();

    const features = await replay(opencodeAdapter, recordings["features-2"], replayOptions, {
      toolServers: [team, app],
    });
    const sent = features.written.map((line) => JSON.parse(line));
    expect(sent[0].params.clientCapabilities).toMatchObject({
      elicitation: { form: {} },
      _meta: { "opencode/child-session-updates": true },
    });
    expect(sent[1].params.mcpServers.map((server: { name: string }) => server.name)).toEqual([
      "notes-x",
    ]);
    expect(sent.map((message) => message.method)).toContain("_session/steering");
    expect(sent.map((message) => message.method)).not.toContain("session/cancel");
    const started = only(features.events, "action.started").map((event) => event.payload);
    const script = started.find((action) => action.title === "execute");
    expect(started.filter((action) => action.parentActionId === script?.actionId)).toMatchObject([
      { tool: { server: "notes-x", name: "create_note" } },
      { tool: { server: "notes-x", name: "search_notes" } },
    ]);
    expect(
      only(features.events, "question.requested")[0]?.payload.questions[0]?.options,
    ).toMatchObject([{ label: "Red" }, { label: "Blue" }]);
    expect(sent.find((message) => message.result?.action === "accept")?.result.content).toEqual({
      q0: "Blue",
    });

    // A background sub-agent's call stays open until it ends, with its steps inside it.
    const sub = await replay(opencodeAdapter, recordings["subagent-2"]);
    const subagent = only(sub.events, "action.started").find((e) => e.payload.kind === "delegate");
    const parent = subagent?.payload.actionId;
    const inside = sub.events.filter(
      (event) =>
        (event.type === "action.started" || event.type === "message") &&
        event.payload.parentActionId === parent,
    );
    expect(inside.map((event) => event.type)).toEqual(
      expect.arrayContaining(["action.started", "message"]),
    );
    const firstTurnEnd = sub.events.findIndex((event) => event.type === "turn.ended");
    const subagentEnd = sub.events.findIndex(
      (event) => event.type === "action.ended" && event.payload.actionId === parent,
    );
    expect(subagentEnd).toBeGreaterThan(firstTurnEnd);
  });
});
