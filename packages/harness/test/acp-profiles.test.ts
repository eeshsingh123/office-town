import { describe, expect, it } from "vitest";
import { copilotAdapter } from "../src/adapters/copilot/adapter.ts";
import { cursorAdapter } from "../src/adapters/cursor/adapter.ts";
import { replayOptions } from "./support/replay.ts";

describe("ACP launch profiles", () => {
  it("launch Copilot and Cursor with the account's own folder and nothing secret on the command line", () => {
    const options = {
      ...replayOptions,
      permissionMode: "bypass" as const,
      model: "gpt-6.1-sol",
      accountFolder: "/accounts/work",
      additionalPaths: ["/notes"],
      toolServers: [
        {
          transport: "http" as const,
          name: "office-town",
          token: "secret",
          url: "http://127.0.0.1:1/mcp",
          headers: { Authorization: "Bearer secret" },
        },
      ],
    };
    expect(copilotAdapter.buildCommand(options)).toEqual({
      binary: "copilot",
      args: [
        "--acp",
        "--model",
        "gpt-6.1-sol",
        "--add-dir",
        "/notes",
        "--allow-tool",
        "office-town",
        "--allow-all",
      ],
      env: { COPILOT_HOME: "/accounts/work" },
    });
    expect(cursorAdapter.buildCommand(options)).toEqual({
      binary: "cursor-agent",
      args: ["acp"],
      env: { CURSOR_CONFIG_DIR: "/accounts/work" },
    });
  });
});
