import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { copilotAdapter } from "../src/adapters/copilot/adapter.ts";
import { cursorAdapter } from "../src/adapters/cursor/adapter.ts";
import { type RecordingEntry, replay, replayOptions } from "./support/replay.ts";

const loads = {
  agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
};
const update = (text: string) => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "s1",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  },
});
const models = {
  configOptions: [
    {
      id: "model",
      category: "model",
      currentValue: "auto",
      options: [{ value: "auto" }, { value: "gpt-6.1-sol" }],
    },
  ],
};

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

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

  it("chooses the model over ACP where the command line cannot, then prompts", async () => {
    const recording: RecordingEntry[] = [
      { receive: { jsonrpc: "2.0", id: 1, result: loads } },
      { receive: { jsonrpc: "2.0", id: 2, result: { sessionId: "s1", ...models } } },
      { send: { type: "prompt", text: "Hi" } },
      { receive: { jsonrpc: "2.0", id: 3, result: models } },
      { receive: update("Hello") },
      { receive: { jsonrpc: "2.0", id: 4, result: { stopReason: "end_turn" } } },
    ];
    const { events, written } = await replay(cursorAdapter, recording, {
      ...replayOptions,
      model: "gpt-6.1-sol",
    });
    expect(JSON.parse(written[2] ?? "")).toMatchObject({
      method: "session/set_config_option",
      params: { configId: "model", value: "gpt-6.1-sol" },
    });
    expect(JSON.parse(written[3] ?? "").method).toBe("session/prompt");
    expect(only(events, "session.started")[0]?.payload.model).toBe("gpt-6.1-sol");
  });

  it("resumes a harness without session/resume by loading the session, leaving its replay out", async () => {
    const recording: RecordingEntry[] = [
      { receive: { jsonrpc: "2.0", id: 1, result: loads } },
      { receive: update("An old reply") },
      { receive: { jsonrpc: "2.0", id: 2, result: {} } },
      { send: { type: "prompt", text: "Carry on" } },
      { receive: update("A new reply") },
      { receive: { jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } } },
    ];
    const { events, written } = await replay(copilotAdapter, recording, {
      ...replayOptions,
      resumeSessionId: "s1",
    });
    expect(JSON.parse(written[1] ?? "")).toMatchObject({
      method: "session/load",
      params: { sessionId: "s1" },
    });
    const replies = only(events, "message").filter((event) => event.payload.role === "assistant");
    expect(replies.map((event) => event.payload.text)).toEqual(["A new reply"]);
  });

  it("allows the core's own tools without asking", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const recording: RecordingEntry[] = [
      { receive: { jsonrpc: "2.0", id: 1, result: loads } },
      { receive: { jsonrpc: "2.0", id: 2, result: { sessionId: "s1" } } },
      { send: { type: "prompt", text: "Delegate" } },
      {
        receive: {
          jsonrpc: "2.0",
          id: 7,
          method: "session/request_permission",
          params: {
            sessionId: "s1",
            toolCall: { toolCallId: "t1", title: "office-town-delegate", kind: "other" },
            options: [
              { optionId: "yes", name: "Allow", kind: "allow_once" },
              { optionId: "no", name: "Deny", kind: "reject_once" },
            ],
          },
        },
      },
      { receive: { jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } } },
    ];
    const { events, written } = await replay(copilotAdapter, recording, replayOptions, {
      toolServers: [toolServer],
    });
    expect(only(events, "permission.requested")).toEqual([]);
    expect(written.map((line) => JSON.parse(line))).toContainEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "selected", optionId: "yes" } },
    });
  });
});
