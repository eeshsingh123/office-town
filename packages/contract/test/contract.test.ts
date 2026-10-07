import { describe, expect, it } from "vitest";
import { sessionCommandSchema, sessionOptionsSchema } from "../src/index.ts";

const options = { harness: "claude", environment: { kind: "native" }, permissionMode: "ask" };

describe("contract", () => {
  it("accepts the names harnesses use, and rejects one that could be read as a command-line flag", () => {
    expect(sessionOptionsSchema.parse(options)).toEqual(options);
    for (const model of ["opus[1m]", "opencode/big-pickle", "openrouter/meta/llama-4:free"]) {
      expect(sessionOptionsSchema.safeParse({ ...options, model }).success).toBe(true);
    }
    // These values become command-line arguments of a harness.
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
