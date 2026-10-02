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
  { type: "message.delta", payload: { text: "hel" } },
  { type: "reasoning.delta", payload: { text: "thin", parentActionId: "action-1" } },
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
  {
    type: "limits.updated",
    payload: {
      limits: [
        {
          id: "five_hour",
          label: "five hour",
          usedFraction: 0.4,
          resetsAt: "2026-10-02T15:00:00.000Z",
        },
      ],
    },
  },
  { type: "error", payload: { message: "boom", fatal: true } },
];

const options = { harness: "claude", environment: { kind: "native" }, permissionMode: "ask" };

describe("contract", () => {
  it("accepts every event type and rejects an unknown type or a mismatched payload", () => {
    for (const body of bodies) {
      const event = { ...envelope, ...body };
      expect(sessionEventSchema.parse(event)).toEqual(event);
    }
    const unknown = { ...envelope, type: "session.paused", payload: {} };
    const mismatched = { ...envelope, type: "turn.ended", payload: { turnId: "1", outcome: "x" } };
    expect(sessionEventSchema.safeParse(unknown).success).toBe(false);
    expect(sessionEventSchema.safeParse(mismatched).success).toBe(false);
  });

  it("accepts the names harnesses use for models and sessions", () => {
    expect(sessionOptionsSchema.parse(options)).toEqual(options);
    for (const model of ["opus[1m]", "opencode/big-pickle", "openrouter/meta/llama-4:free"]) {
      expect(sessionOptionsSchema.safeParse({ ...options, model }).success).toBe(true);
    }
  });

  // These values become command-line arguments of a harness.
  it("rejects a model, effort or session id that could be read as a command-line flag", () => {
    for (const value of ["--dangerously-skip-permissions", "-x", "a b", ""]) {
      for (const field of ["model", "effort", "resumeSessionId"]) {
        expect(sessionOptionsSchema.safeParse({ ...options, [field]: value }).success).toBe(false);
      }
    }
  });

  it("requires a question's answer to select something", () => {
    const answer = (selected: string[]) => ({
      type: "answerQuestion",
      requestId: "request-2",
      answers: [{ questionId: "1", selected }],
    });
    expect(sessionCommandSchema.safeParse(answer(["Blue"])).success).toBe(true);
    expect(sessionCommandSchema.safeParse(answer([])).success).toBe(false);
  });
});
