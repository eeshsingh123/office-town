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
  it("attaches the core's tool servers over ACP, keeps their tokens out of the reported lines, allows their tools, and reports calls to them as theirs", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const attached = {
      transport: "http" as const,
      name: "office-town",
      token: "secret",
      url: toolServer.url,
      headers: { Authorization: "Bearer secret" },
    };
    expect(configOf({ ...replayOptions, toolServers: [attached] }).permission).toMatchObject({
      "office-town_*": "allow",
    });

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
  });
});
