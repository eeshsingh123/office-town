import { describe, expect, it } from "vitest";
import {
  type SessionEventBody,
  sessionCommandSchema,
  sessionEventSchema,
  sessionOptionsSchema,
} from "../src/index.ts";

const envelope = {
  id: "0b0e3d1c-6f0a-4c56-9d1e-2f6b8c1a7e42",
  sessionId: "session-1",
  sequence: 1,
  timestamp: "2026-10-02T10:00:00.000Z",
};

const bodies: SessionEventBody[] = [
  { type: "session.started", payload: { harnessSessionId: "native-1", model: "some-model" } },
  { type: "session.ended", payload: { reason: "exited", exitCode: 0 } },
  { type: "turn.started", payload: { turnId: "turn-1" } },
  {
    type: "turn.ended",
    payload: {
      turnId: "turn-1",
      outcome: "completed",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  },
  { type: "message", payload: { role: "assistant", text: "hello" } },
  { type: "reasoning", payload: { text: "thinking", parentActionId: "action-1" } },
  { type: "plan.updated", payload: { steps: [{ id: "1", title: "look", status: "in_progress" }] } },
  {
    type: "action.started",
    payload: { actionId: "action-1", kind: "execute", title: "ls", input: { command: "ls" } },
  },
  { type: "action.updated", payload: { actionId: "action-1", output: "partial" } },
  { type: "action.ended", payload: { actionId: "action-1", outcome: "completed", result: "ok" } },
  {
    type: "permission.requested",
    payload: {
      requestId: "request-1",
      actionId: "action-1",
      title: "Write hello.txt",
      input: { path: "hello.txt" },
      options: [{ optionId: "allow", label: "Allow", kind: "allow_once" }],
    },
  },
  { type: "permission.resolved", payload: { requestId: "request-1", outcome: "allowed" } },
  {
    type: "question.requested",
    payload: {
      requestId: "request-2",
      questions: [
        {
          questionId: "1",
          text: "Which colour?",
          options: [{ label: "Red" }, { label: "Blue", description: "Calm" }],
          multiSelect: false,
        },
      ],
    },
  },
  {
    type: "question.resolved",
    payload: {
      requestId: "request-2",
      outcome: "answered",
      answers: [{ questionId: "1", selected: ["Blue"] }],
    },
  },
  { type: "error", payload: { message: "boom", fatal: true } },
];

describe("session events", () => {
  it.each(bodies)("accepts a valid $type event", (body) => {
    const event = { ...envelope, ...body };
    expect(sessionEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an unknown event type", () => {
    const event = { ...envelope, type: "session.paused", payload: {} };
    expect(sessionEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects a payload that does not match its type", () => {
    const event = {
      ...envelope,
      type: "turn.ended",
      payload: { turnId: "1", outcome: "exploded" },
    };
    expect(sessionEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects a sequence that is not a positive integer", () => {
    const event = { ...envelope, ...bodies[0], sequence: 0 };
    expect(sessionEventSchema.safeParse(event).success).toBe(false);
  });
});

describe("session options", () => {
  it("accepts the minimum a caller must choose", () => {
    const options = { harness: "claude", environment: { kind: "native" }, permissionMode: "ask" };
    expect(sessionOptionsSchema.parse(options)).toEqual(options);
  });

  it("requires a distro for the wsl environment", () => {
    const options = { harness: "claude", environment: { kind: "wsl" }, permissionMode: "ask" };
    expect(sessionOptionsSchema.safeParse(options).success).toBe(false);
  });

  it.each(["sonnet", "opus[1m]", "opencode/big-pickle", "openrouter/meta/llama-4:free"])(
    "accepts the model name %s",
    (model) => {
      const options = { harness: "x", environment: { kind: "native" }, permissionMode: "ask" };
      expect(sessionOptionsSchema.safeParse({ ...options, model }).success).toBe(true);
    },
  );

  it.each(["--dangerously-skip-permissions", "-x", "a b", ""])(
    "rejects the model or effort value %j, which could be read as a command-line flag",
    (value) => {
      const options = { harness: "x", environment: { kind: "native" }, permissionMode: "ask" };
      expect(sessionOptionsSchema.safeParse({ ...options, model: value }).success).toBe(false);
      expect(sessionOptionsSchema.safeParse({ ...options, effort: value }).success).toBe(false);
    },
  );
});

describe("session commands", () => {
  it("accepts a permission answer", () => {
    const command = { type: "answerPermission", requestId: "request-1", optionId: "allow" };
    expect(sessionCommandSchema.parse(command)).toEqual(command);
  });

  it("accepts an answer to a question and rejects one that selects nothing", () => {
    const command = {
      type: "answerQuestion",
      requestId: "request-2",
      answers: [{ questionId: "1", selected: ["Blue"] }],
    };
    expect(sessionCommandSchema.parse(command)).toEqual(command);
    const empty = { ...command, answers: [{ questionId: "1", selected: [] }] };
    expect(sessionCommandSchema.safeParse(empty).success).toBe(false);
  });

  it("rejects an empty prompt", () => {
    expect(sessionCommandSchema.safeParse({ type: "prompt", text: "" }).success).toBe(false);
  });
});
