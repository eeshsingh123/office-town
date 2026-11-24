import type { SessionEvent } from "@office-town/contract";
import type { Queued } from "./outbox.ts";

type Asked = Extract<
  SessionEvent,
  { type: "permission.requested" | "question.requested" | "plan.requested" }
>;

export const isAsk = (event: SessionEvent): event is Asked =>
  event.type === "permission.requested" ||
  event.type === "question.requested" ||
  event.type === "plan.requested";

function bodyOf(event: Asked): string {
  if (event.type === "permission.requested") return event.payload.title;
  if (event.type === "question.requested") {
    return event.payload.questions.map((one) => one.text).join("\n");
  }
  return event.payload.pieces.map((piece, index) => `${index + 1}. ${piece.title}`).join("\n");
}

// The ask as it goes out: who asks and what, in its own words. Every destination is one way, so it
// is answered in Office Town (D-130).
export function askMessage(event: Asked, who: string, title: string): Queued {
  return {
    kind: "ask",
    title: `${title}: ${who} needs you`,
    text: `${bodyOf(event)}\n\nAnswer it in Office Town.`,
  };
}
