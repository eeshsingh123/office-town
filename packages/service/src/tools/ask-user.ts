import { randomUUID } from "node:crypto";
import type { Question } from "@office-town/contract";
import { z } from "zod";
import { AnswerError, type SessionRegistry } from "../registry/session-registry.ts";
import { defineTool } from "./tools.ts";

// Puts a question in Needs you; the agent hears `reply` of the answer as a message.
export function putQuestion(
  registry: SessionRegistry,
  sessionId: string,
  asked: Omit<Question, "questionId">,
  reply: (selected: string[]) => string,
): void {
  const requestId = `ask-${randomUUID()}`;
  registry.ask(
    sessionId,
    {
      type: "question.requested",
      payload: { requestId, questions: [{ questionId: "1", ...asked }] },
    },
    (command) => {
      if (command.type !== "answerQuestion") throw new AnswerError("This is a question.");
      const { answers } = command;
      return {
        resolution: {
          type: "question.resolved",
          payload: { requestId, outcome: "answered", answers },
        },
        afterwards: () =>
          registry.tell(sessionId, {
            text: reply(answers.flatMap((answer) => answer.selected)),
            origin: { kind: "answer", requestId },
          }),
      };
    },
  );
}

const inputSchema = z.object({
  question: z.string().min(1).describe("The question, in plain words."),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe("Answers to offer. The user may always answer in their own words."),
  multiSelect: z.boolean().optional().describe("Whether the user may pick several options."),
});

// For a harness with no way of its own, such as OpenCode over ACP, this is the only one.
export function askUser(registry: SessionRegistry) {
  return defineTool({
    name: "ask_user",
    description:
      "Ask the user a question when you cannot go on without their decision. It returns at " +
      "once; the answer reaches you later as a message. End your turn if you need it first.",
    input: inputSchema,
    offeredTo: () => true,
    call({ question, options = [], multiSelect = false }, caller) {
      putQuestion(
        registry,
        caller.sessionId,
        { text: question, options: options.map((label) => ({ label })), multiSelect },
        (selected) => `The user answered your question "${question}": ${selected.join(", ")}`,
      );
      return "Your question is with the user. Their answer will reach you as a message.";
    },
  });
}
