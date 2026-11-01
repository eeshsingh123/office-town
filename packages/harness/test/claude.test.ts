import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../src/adapters/claude/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replay, replayOptions } from "./support/replay.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", "claude", name);
const recording = (name: string) => loadRecording(fixture(`${name}.jsonl`));

const recordings = {
  "write-allowed": recording("write-allowed"),
  "write-denied": recording("write-denied"),
  "plan-and-subagent": recording("plan-and-subagent"),
  "plan-other-names": recording("plan-other-names"),
  "interrupt-running": recording("interrupt-running"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "question-answered": recording("question-answered"),
  "resumed-streamed": recording("resumed-streamed"),
  "team-tool": recording("team-tool"),
  "mid-turn-message": recording("mid-turn-message"),
};

const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };

describeAdapterConformance(claudeAdapter, recordings);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

describe("claude adapter", () => {
  it("attaches the core's tool servers with their tokens off the command line, allows their tools, and reports calls to them as theirs", async () => {
    const headers = { Authorization: "Bearer secret" };
    const { args, env } = claudeAdapter.buildCommand({
      ...replayOptions,
      toolServers: [
        { transport: "http", name: "office-town", token: "secret", url: toolServer.url, headers },
      ],
    });
    expect(args.join(" ")).not.toContain("secret");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "")).toEqual({
      mcpServers: {
        "office-town": {
          type: "http",
          url: toolServer.url,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a variable Claude fills in
          headers: { Authorization: "Bearer ${OFFICE_TOWN_TOOL_TOKEN_0}" },
        },
      },
    });
    expect(env).toEqual({
      OFFICE_TOWN_TOOL_TOKEN_0: "secret",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__office-town");
    expect(claudeAdapter.buildCommand(replayOptions).args).not.toContain("--mcp-config");

    const { events } = await replay(claudeAdapter, recordings["team-tool"], replayOptions, {
      toolServers: [toolServer],
    });
    expect(only(events, "action.started").map((event) => event.payload.tool)).toEqual([
      undefined,
      { server: "office-town", name: "ask_user" },
    ]);
    expect(only(events, "permission.requested")).toEqual([]);
  });

  it("keeps out the user's and the project's own files, settings, MCP servers and skills when isolated", () => {
    const args = claudeAdapter.buildCommand({ ...replayOptions, isolated: true }).args.join(" ");
    expect(args).toContain("--setting-sources  --disable-slash-commands");
    expect(claudeAdapter.capabilities.isolation).toBe("full");
  });

  // D-68: Claude apps load for the login unless blocked, so an agent gets only its own, and
  // every call to one asks, for the core to decide.
  it("blocks the login's other Claude apps and asks before each call to an allowed one", () => {
    const { args, env } = claudeAdapter.buildCommand({
      ...replayOptions,
      vendorApps: ["claude.ai Notion"],
      blockedApps: ["claude.ai Gmail"],
    });
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({
      deniedMcpServers: [{ serverName: "claude.ai Gmail" }],
      permissions: { ask: ["mcp__claude_ai_Notion"] },
    });
    expect(env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    expect(claudeAdapter.buildCommand(replayOptions).env?.ENABLE_CLAUDEAI_MCP_SERVERS).toBe(
      "false",
    );
  });
});
