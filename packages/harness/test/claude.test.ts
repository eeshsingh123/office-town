import path from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../src/adapters/claude/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import {
  loadLines,
  loadRecording,
  type RecordingEntry,
  replay,
  replayOptions,
} from "./support/replay.ts";

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
};

const catalogOutput = loadLines(fixture("catalog.jsonl")).filter((line) => line !== "");

describeAdapterConformance(claudeAdapter, recordings, catalogOutput);

function only<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type);
}

const types = (events: SessionEvent[]) => events.map((event) => event.type);

describe("claude adapter", () => {
  it("passes model, effort and additional folders to the CLI only when chosen", () => {
    const plain = claudeAdapter.buildCommand(replayOptions);
    const tuned = claudeAdapter.buildCommand({
      ...replayOptions,
      model: "sonnet",
      effort: "high",
      additionalPaths: ["/notes", "/data"],
    });

    expect(plain.binary).toBe("claude");
    expect(plain.args).not.toContain("--model");
    expect(plain.args).not.toContain("--effort");
    expect(plain.args).not.toContain("--add-dir");
    expect(tuned.args.join(" ")).toContain("--model sonnet --effort high");
    expect(tuned.args.join(" ")).toContain("--add-dir /notes --add-dir /data");
  });

  it("resumes an earlier session by its id, and reports the same id again", async () => {
    const resumeSessionId = "0036e5e3-8459-41a1-96ac-19a516ceb281";
    const command = claudeAdapter.buildCommand({ ...replayOptions, resumeSessionId });
    const { events } = await replay(claudeAdapter, recordings["resumed-streamed"]);

    expect(claudeAdapter.buildCommand(replayOptions).args).not.toContain("--resume");
    expect(command.args.join(" ")).toContain(`--resume ${resumeSessionId}`);
    expect(only(events, "session.started")[0]?.payload.harnessSessionId).toBe(resumeSessionId);
  });

  it("reports a reply's text as it is produced, then the whole reply", async () => {
    const { events } = await replay(claudeAdapter, recordings["resumed-streamed"]);

    const fragments = only(events, "message.delta").map((event) => event.payload.text);
    const replies = only(events, "message").filter((e) => e.payload.role === "assistant");
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.join("")).toBe("Mango.");
    expect(replies.map((event) => event.payload.text)).toEqual(["Mango."]);
    expect(events.findLastIndex((event) => event.type === "message.delta")).toBeLessThan(
      events.findLastIndex((event) => event.type === "message"),
    );
  });

  it("reads its models and their effort values from the CLI's description of itself", () => {
    expect(claudeAdapter.catalog?.parse(catalogOutput).models).toEqual([
      {
        id: "default",
        name: "Default (recommended)",
        description: "Opus 5.5 · Best for everyday, complex tasks",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "sonnet",
        name: "Sonnet 5.5",
        description: "Efficient for routine tasks",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
      { id: "haiku", name: "Haiku 4.5", description: "Fastest for quick answers", efforts: [] },
    ]);
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
      "limits.updated",
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

  it("reports how much of each subscription window is used and when it resets", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-and-subagent"]);

    expect(only(events, "limits.updated")[0]?.payload.limits).toEqual([
      {
        id: "five_hour",
        label: "five hour",
        usedFraction: 0.04,
        resetsAt: "2026-10-02T16:40:00.000Z",
      },
      {
        id: "seven_day",
        label: "seven day",
        usedFraction: 0.04,
        resetsAt: "2026-10-06T13:00:00.000Z",
      },
    ]);
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

  it("reports a question as a question and hands the user's answer back", async () => {
    const { events, written } = await replay(claudeAdapter, recordings["question-answered"]);

    expect(only(events, "permission.requested")).toEqual([]);
    const [asked] = only(events, "question.requested");
    const [question] = asked?.payload.questions ?? [];
    expect(question?.options.map((option) => option.label)).toEqual(["Red", "Blue"]);
    expect(question?.multiSelect).toBe(false);
    expect(asked?.payload.actionId).toBe(only(events, "action.started")[0]?.payload.actionId);

    expect(JSON.parse(written[1] as string).response.response).toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { [question?.text as string]: "Blue" } },
    });
    expect(only(events, "question.resolved")[0]?.payload).toEqual({
      requestId: asked?.payload.requestId,
      outcome: "answered",
      answers: [{ questionId: "1", selected: ["Blue"] }],
    });
    expect(only(events, "action.ended")[0]?.payload.result).toContain("Blue");
  });

  it("cancels a pending question when the harness withdraws it", async () => {
    const untilAsked = recordings["question-answered"].slice(0, 7);
    const { events: asked } = await replay(claudeAdapter, untilAsked);
    const requestId = only(asked, "question.requested")[0]?.payload.requestId;
    expect(requestId).toBeDefined();

    const { events } = await replay(claudeAdapter, [
      ...untilAsked,
      { receive: { type: "control_cancel_request", request_id: requestId } },
    ]);

    expect(only(events, "question.resolved").map((event) => event.payload)).toEqual([
      { requestId, outcome: "cancelled" },
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

  it("reads the plan from what the CLI recorded, whatever the model named the fields", async () => {
    const { events } = await replay(claudeAdapter, recordings["plan-other-names"]);

    expect(only(events, "error")).toEqual([]);
    expect(only(events, "plan.updated").at(-1)?.payload.steps).toEqual([
      { id: "1", title: "List files", status: "completed" },
      { id: "2", title: "Report", status: "completed" },
    ]);
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
