import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { codexAdapter } from "../src/adapters/codex/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replay, replayOptions } from "./support/replay.ts";

const recording = (name: string) =>
  loadRecording(path.join(import.meta.dirname, "fixtures", "codex", `${name}.jsonl`));

const recordings = {
  "command-approved": recording("command-approved"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "question-answered": recording("question-answered"),
};

describeAdapterConformance(codexAdapter, recordings);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

describe("codex adapter", () => {
  it("attaches the core's tool servers without their tokens on the command line, never asks for their tools, and writes no read-only folder", () => {
    const command = codexAdapter.buildCommand({
      ...replayOptions,
      accountFolder: "/accounts/work",
      additionalPaths: ["/notes", "/papers"],
      readOnlyPaths: ["/papers"],
      toolServers: [
        {
          transport: "http",
          name: "office-town",
          token: "secret",
          url: "http://127.0.0.1:1/mcp",
          headers: { Authorization: "Bearer secret" },
        },
      ],
    });
    expect(command.args).toEqual([
      "app-server",
      "-c",
      'mcp_servers.office-town.url="http://127.0.0.1:1/mcp"',
      "-c",
      'mcp_servers.office-town.bearer_token_env_var="OFFICE_TOWN_TOOL_TOKEN_0"',
      "-c",
      'mcp_servers.office-town.default_tools_approval_mode="auto"',
      "-c",
      'sandbox_workspace_write.writable_roots=["/notes"]',
    ]);
    expect(command.args.join(" ")).not.toContain("secret");
    expect(command.env).toEqual({
      CODEX_HOME: "/accounts/work",
      OFFICE_TOWN_TOOL_TOKEN_0: "secret",
    });
  });

  it("asks in the sandbox under Ask, reports the turn's own tokens and the plan's windows", async () => {
    const { events, written } = await replay(codexAdapter, recordings["command-approved"]);
    const thread = JSON.parse(written[2] ?? "");
    expect(thread).toMatchObject({
      method: "thread/start",
      params: { cwd: "/workspace", approvalPolicy: "untrusted", sandbox: "workspace-write" },
    });
    expect(JSON.parse(written[4] ?? "")).toMatchObject({ id: 0, result: { decision: "accept" } });
    expect(only(events, "plan.updated")[0]?.payload.steps[0]).toEqual({
      id: "1",
      title: "Write hello.txt",
      status: "in_progress",
    });
    expect(only(events, "turn.ended")[0]?.payload.usage).toEqual({
      inputTokens: 9000,
      outputTokens: 120,
      cachedInputTokens: 6000,
      contextTokens: 4600,
    });
    expect(only(events, "limits.updated")[0]?.payload.limits.map((limit) => limit.id)).toEqual([
      "five_hour",
      "seven_day",
    ]);
  });

  it("names the files a change touches when it asks, so read-only folders stay guarded", async () => {
    const { events } = await replay(codexAdapter, recordings["interrupt-pending-permission"]);
    expect(only(events, "permission.requested")[0]?.payload.locations).toEqual([
      "/workspace/notes.md",
    ]);
  });
});
