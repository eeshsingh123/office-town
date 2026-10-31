import { z } from "zod";
import { putQuestion } from "../tools/ask-user.ts";
import { type Caller, defineTool } from "../tools/tools.ts";
import { isLead } from "./delegate.ts";
import type { TeamContext } from "./members.ts";

const APPROVE = "Go ahead";
const DECLINE = "Keep to the goal";

function answerText(change: string, ifDeclined: string, selected: string[]): string {
  const [answer] = selected;
  if (selected.length === 1 && answer === APPROVE) {
    return `The user approved your change: ${change}\nCarry on with it.`;
  }
  if (selected.length === 1 && answer === DECLINE) {
    return `The user declined your change: ${change}\nDo not make it. Keep to the goal as asked: ${ifDeclined}`;
  }
  return `The user answered your proposed change "${change}" in their own words: ${selected.join(", ")}\nDo what they say. Unless they clearly approve the change, do not make it.`;
}

// A question, not an approval: "Approve all" must never settle a change of direction, and the
// user can always answer in their own words. It goes to the user at every autonomy level (owner).
export function proposeChange(context: TeamContext) {
  return defineTool({
    name: "propose_change",
    description:
      "Ask the user before you change direction: dropping or replacing something the goal " +
      "names, delivering a different thing from what was asked (such as building a copy when " +
      "the goal is the real thing), or finishing with less than the goal. Not for choices that " +
      "still deliver the goal. It returns at once; the answer reaches you later as a message. " +
      "Do not start the change before then.",
    input: z.object({
      asked: z.string().trim().min(1).describe("What the goal asked for, in a sentence."),
      found: z
        .string()
        .trim()
        .min(1)
        .describe("Why it cannot go as asked: what you tried and what you found."),
      change: z
        .string()
        .trim()
        .min(1)
        .describe("What you want to do instead, and what gets dropped."),
      if_declined: z
        .string()
        .trim()
        .min(1)
        .describe("What you will do if the user says no, in a sentence."),
    }),
    offeredTo: isLead(context),
    call({ asked, found, change, if_declined }, caller: Caller) {
      putQuestion(
        context.registry,
        caller.sessionId,
        {
          text: `Change of direction: ${change}\n\nThe goal asked for: ${asked}\n\nWhat it found: ${found}`,
          options: [
            { label: APPROVE, description: change },
            { label: DECLINE, description: if_declined },
          ],
          multiSelect: false,
        },
        (selected) => answerText(change, if_declined, selected),
      );
      return "Your change is with the user. Do not start it: end your turn, and their answer will reach you as a message.";
    },
  });
}
