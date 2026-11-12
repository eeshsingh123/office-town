import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexAdapter } from "../src/adapters/codex/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replayOptions } from "./support/replay.ts";

const recording = (name: string) =>
  loadRecording(path.join(import.meta.dirname, "fixtures", "codex", `${name}.jsonl`));

const recordings = {
  "command-approved": recording("command-approved"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
  "question-answered": recording("question-answered"),
};

describeAdapterConformance(codexAdapter, recordings);

describe("codex adapter", () => {
  it("attaches the core's tool servers without their tokens on the command line, never asks for their tools, turns on only allowed apps, each asking, and writes no read-only folder", () => {
    const command = codexAdapter.buildCommand({
      ...replayOptions,
      accountFolder: "/accounts/work",
      additionalPaths: ["/notes", "/papers"],
      readOnlyPaths: ["/papers"],
      vendorApps: ["connector_gmail"],
      blockedApps: ["connector_drive", "own-server"],
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
      "apps._default.enabled=false",
      "-c",
      "apps.connector_gmail.enabled=true",
      "-c",
      'apps.connector_gmail.default_tools_approval_mode="prompt"',
      "-c",
      "mcp_servers.own-server.enabled=false",
      "-c",
      'sandbox_workspace_write.writable_roots=["/notes"]',
    ]);
    expect(command.args.join(" ")).not.toContain("secret");
    expect(command.env).toEqual({
      CODEX_HOME: "/accounts/work",
      OFFICE_TOWN_TOOL_TOKEN_0: "secret",
    });
  });
});
