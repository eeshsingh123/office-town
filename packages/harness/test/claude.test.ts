import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../src/adapters/claude/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording, type RecordingEntry, replay, replayOptions } from "./support/replay.ts";

const recording = (name: string) =>
  loadRecording(path.join(import.meta.dirname, "fixtures", "claude", `${name}.jsonl`));

const recordings = {
  "write-allowed": recording("write-allowed"),
  "write-denied": recording("write-denied"),
  "plan-and-subagent": recording("plan-and-subagent"),
  "interrupt-running": recording("interrupt-running"),
  "interrupt-pending-permission": recording("interrupt-pending-permission"),
};

describeAdapterConformance(claudeAdapter, recordings);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

const types = (events: SessionEvent[]) => events.map((event) => event.type);

describe("claude adapter", () => {
  it("passes model and effort to the CLI only when chosen", () => {
    const plain = claudeAdapter.buildCommand(replayOptions);
    const tuned = claudeAdapter.buildCommand({ ...replayOptions, model: "sonnet", effort: "high" });

    expect(plain.binary).toBe("claude");
    expect(plain.args).not.toContain("--model");
    expect(plain.args).not.toContain("--effort");
    expect(tuned.args.join(" ")).toContain("--model sonnet --effort high");
  });

  it("reports a write, asks permission for it and completes it once allowed", async () => {
    const { events, written } = await replay(claudeAdapter, recordings["write-allowed"]);

    expect(types(events)).toEqual([
      "message",
      "session.started",
      "turn.started",
      "message",
      "action.started",
      "permission.requested",
      "permission.resolved",
      "action.ended",
      "action.started",
      "action.ended",
      "message",
      "turn.ended",
      "session.ended",
    ]);
    const [write, shell] = only(events, "action.started");
    expect(write?.payload).toMatchObject({
      kind: "edit",
      title: "Write: C:\\work\\hello.txt",
      locations: ["C:\\work\\hello.txt"],
    });
    expect(shell?.payload).toMatchObject({ kind: "execute", title: "Bash: Run echo done command" });

    const [request] = only(events, "permission.requested");
    expect(request?.payload.actionId).toBe(write?.payload.actionId);
    expect(request?.payload.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
    ]);
    expect(JSON.parse(written[1] as string)).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request?.payload.requestId,
        response: { behavior: "allow", updatedInput: request?.payload.input },
      },
    });
    expect(only(events, "turn.ended")[0]?.payload).toMatchObject({
      outcome: "completed",
      usage: { inputTokens: 72122, outputTokens: 453, cachedInputTokens: 34545 },
    });
  });

  it("says what allowing always will change, and returns that change to the harness", async () => {
    const allowAlways = recordings["write-allowed"].map(
      (entry): RecordingEntry =>
        "send" in entry && entry.send.type === "answerPermission"
          ? { send: { type: "answerPermission", choose: "allow_always" } }
          : entry,
    );
    const { events, written } = await replay(claudeAdapter, allowAlways);

    const options = only(events, "permission.requested")[0]?.payload.options;
    expect(options?.find((option) => option.kind === "allow_always")?.label).toBe(
      "Allow all file edits for this session",
    );
    expect(JSON.parse(written[1] as string).response.response.updatedPermissions).toEqual([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
  });

  it("offers only changes that end with the session", async () => {
    const sessionRule = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test" }],
      behavior: "allow",
      destination: "session",
    };
    const request = (id: string, suggestions: unknown[]): RecordingEntry => ({
      receive: {
        type: "control_request",
        request_id: id,
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: {},
          permission_suggestions: suggestions,
        },
      },
    });
    const { events, written } = await replay(claudeAdapter, [
      request("saved-to-disk", [{ ...sessionRule, destination: "localSettings" }]),
      request("mixed", [sessionRule, { type: "setMode", mode: "acceptEdits" }]),
      { send: { type: "answerPermission", choose: "allow_always" } },
    ]);

    const [savedToDisk, mixed] = only(events, "permission.requested");
    expect(savedToDisk?.payload.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "reject_once",
    ]);
    expect(mixed?.payload.options[1]?.label).toBe("Always allow Bash (npm test) for this session");
    expect(JSON.parse(written[0] as string).response.response.updatedPermissions).toEqual([
      sessionRule,
    ]);
  });

  it("fails the action when the user denies it", async () => {
    const { events, written } = await replay(claudeAdapter, recordings["write-denied"]);

    expect(JSON.parse(written[1] as string).response.response.behavior).toBe("deny");
    expect(only(events, "permission.resolved")[0]?.payload.outcome).toBe("denied");
    expect(only(events, "action.ended")[0]?.payload).toMatchObject({ outcome: "failed" });
  });

  it("builds the plan from task tool calls instead of reporting them as actions", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    expect(only(events, "plan.updated").at(-1)?.payload.steps).toEqual([
      { id: "1", title: "Look at files", status: "completed" },
      { id: "2", title: "Report", status: "completed" },
    ]);
    const titles = only(events, "action.started").map((event) => event.payload.title);
    expect(titles.some((title) => title.startsWith("Task"))).toBe(false);
  });

  it("nests a sub-agent's work under its action and ends it when the sub-agent finishes", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    const actions = only(events, "action.started");
    const agent = actions.find((event) => event.payload.kind === "delegate");
    const glob = actions.find((event) => event.payload.title === "Glob: *.txt");
    expect(glob?.payload.parentActionId).toBe(agent?.payload.actionId);

    const ended = only(events, "action.ended");
    const agentEnded = ended.find((event) => event.payload.actionId === agent?.payload.actionId);
    const globEnded = ended.find((event) => event.payload.actionId === glob?.payload.actionId);
    expect(agentEnded?.payload.result).toContain("hello.txt");
    expect(agentEnded?.sequence).toBeGreaterThan(globEnded?.sequence ?? Number.POSITIVE_INFINITY);
  });

  it("ends an interrupted turn as interrupted and keeps the session usable", async () => {
    const { events } = await replay(claudeAdapter, recordings["interrupt-running"]);

    expect(only(events, "turn.ended").map((event) => event.payload.outcome)).toEqual([
      "interrupted",
      "completed",
    ]);
    expect(only(events, "error")).toEqual([]);
  });

  it("cancels a pending permission when the turn is interrupted", async () => {
    const { events } = await replay(claudeAdapter, recordings["interrupt-pending-permission"]);

    expect(only(events, "permission.resolved")[0]?.payload.outcome).toBe("cancelled");
    expect(only(events, "turn.ended")[0]?.payload.outcome).toBe("interrupted");
  });

  it("refuses control requests it does not understand so the CLI is not left waiting", async () => {
    const { written } = await replay(claudeAdapter, [
      { receive: { type: "control_request", request_id: "r1", request: { subtype: "mystery" } } },
    ]);

    expect(JSON.parse(written[0] as string)).toMatchObject({
      type: "control_response",
      response: { subtype: "error", request_id: "r1" },
    });
  });
});
