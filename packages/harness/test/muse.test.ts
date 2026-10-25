import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { museAdapter } from "../src/adapters/muse/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, replay, replayOptions } from "./support/replay.ts";

const recording = (name: string) =>
  loadRecording(path.join(import.meta.dirname, "fixtures", "muse", `${name}.jsonl`));

// echo-turn is a real `muse serve --provider echo` run; the others follow its schema.
describeAdapterConformance(museAdapter, {
  "echo-turn": recording("echo-turn"),
  "tool-approved": recording("tool-approved"),
  "question-answered": recording("question-answered"),
});

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

describe("muse adapter", () => {
  it("answers a permission with Muse's own choice, never offering its persistent rules", async () => {
    const { events, written } = await replay(museAdapter, recording("tool-approved"));
    const [request] = only(events, "permission.requested");
    expect(request?.payload.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
    ]);
    const decided = written
      .map((line) => JSON.parse(line))
      .find((m) => m.method === "approval/decide");
    expect(decided.params).toMatchObject({ approvalId: "ap_1", choiceId: "c-once" });
    expect(only(events, "turn.ended")[0]?.payload.usage).toEqual({
      inputTokens: 5200,
      outputTokens: 120,
      cachedInputTokens: 4000,
      contextTokens: 5320,
    });
    expect(only(events, "limits.updated")[0]?.payload.limits.map((limit) => limit.id)).toEqual([
      "five_hour",
      "seven_day",
    ]);
  });

  it("allows the core's own tools without asking, and reports calls to them as theirs", async () => {
    const toolServer = { name: "office-town", url: "http://127.0.0.1:1/mcp", token: "secret" };
    const { events, written } = await replay(museAdapter, recording("team-tool"), replayOptions, {
      toolServers: [toolServer],
    });
    expect(only(events, "permission.requested")).toEqual([]);
    expect(only(events, "action.started")[0]?.payload.tool).toEqual({
      server: "office-town",
      name: "delegate",
    });
    const start = JSON.parse(written[2] ?? "");
    expect(start.params.config.mcpServers["office-town"]).toEqual({
      transport: "streamableHttp",
      url: toolServer.url,
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("sets the chosen approval mode and model again on a resumed session before prompting", async () => {
    const { written } = await replay(
      museAdapter,
      [
        { receive: { jsonrpc: "2.0", id: 1, result: {} } },
        { receive: { jsonrpc: "2.0", id: 2, result: { session: { sessionId: "s1" } } } },
        { send: { type: "prompt", text: "Carry on" } },
        { receive: { jsonrpc: "2.0", id: 3, result: {} } },
        { receive: { jsonrpc: "2.0", id: 4, result: {} } },
      ],
      { ...replayOptions, resumeSessionId: "s1", permissionMode: "ask", model: "muse-spark-1.2" },
    );
    const sent = written.slice(2).map((line) => JSON.parse(line));
    expect(sent.map((message) => message.method)).toEqual([
      "session/resume",
      "session/setApprovalMode",
      "session/setModel",
      "turn/start",
    ]);
    expect(sent[1].params.mode).toBe("promptUnmatched");
    expect(sent[2].params.model).toEqual({ modelId: "muse-spark-1.2" });
  });
});
