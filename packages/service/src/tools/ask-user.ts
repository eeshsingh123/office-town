import { randomUUID } from "node:crypto";
import type { QuestionAnswer } from "@office-town/contract";
import { z } from "zod";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { defineTool } from "./tools.ts";

const inputSchema = z.object({
  question: z.string().min(1).describe("The question, in plain words."),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe("Answers to offer. The user may always answer in their own words."),
  multiSelect: z.boolean().optional().describe("Whether the user may pick several options."),
});

function answerText(question: string, answers: QuestionAnswer[]): string {
  const chosen = answers.flatMap((answer) => answer.selected).join(", ");
  return `The user answered your question "${question}": ${chosen}`;
}

// Every agent can ask the user; for a harness with no way of its own, such as OpenCode over ACP,
// this is the only one. The question waits in Needs you; the answer comes back as a message.
export function askUser(registry: SessionRegistry) {
  return defineTool({
    name: "ask_user",
    description:
      "Ask the user a question when you cannot go on without their decision. It returns at " +
      "once; the answer reaches you later as a message. End your turn if you need it first.",
    input: inputSchema,
    offeredTo: () => true,
    call({ question, options = [], multiSelect = false }, caller) {
      const requestId = `ask-${randomUUID()}`;
      registry.ask(
        caller.sessionId,
        {
          requestId,
          questions: [
            {
              questionId: "1",
              text: question,
              options: options.map((label) => ({ label })),
              multiSelect,
            },
          ],
        },
        (answers) => {
          const message = {
            text: answerText(question, answers),
            origin: { kind: "answer", requestId },
          } as const;
          registry.tell(caller.sessionId, message).catch((error: unknown) => {
            console.error("Could not give an agent the user's answer.", error);
          });
        },
      );
      return "Your question is with the user. Their answer will reach you as a message.";
    },
  });
}
