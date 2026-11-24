import type { AgentCommand, ApprovedPiece, SessionEvent } from "@office-town/contract";
import { CORE_ASKS } from "../team/members.ts";
import type { Queued } from "./outbox.ts";

// Answered from afar only when little can go wrong: questions, plans, reads and file edits (owner,
// 2026-11-24). Commands, app changes, deletes and the core's own asks wait at the computer (D-132).
const LOW_RISK = new Set(["read", "search", "edit"]);
const MOST_CHOICES = 8;

export const ON_COMPUTER = "Answer this on your computer.";

export interface AskAnswers {
  sessionId: string;
  requestId: string;
  // Each button's answer, and what the message says once it is given.
  choices?: { id: string; label: string; answer: AgentCommand; done: string }[];
  // How a text reply answers: in the question's own words, or a no or a plan change with its reason.
  reply?:
    | { kind: "question"; questionId: string }
    | { kind: "deny"; optionId: string }
    | { kind: "revise" };
}

type Asked = Extract<
  SessionEvent,
  { type: "permission.requested" | "question.requested" | "plan.requested" }
>;

interface Described {
  body: string;
  hint?: string;
  answers?: AskAnswers;
}

type Base = Pick<AskAnswers, "sessionId" | "requestId">;

export const isAsk = (event: SessionEvent): event is Asked =>
  event.type === "permission.requested" ||
  event.type === "question.requested" ||
  event.type === "plan.requested";

const permissionAnswer = (requestId: string, optionId: string): AgentCommand => ({
  type: "answerPermission",
  requestId,
  optionId,
});

function permission(event: Extract<Asked, { type: "permission.requested" }>, base: Base) {
  const { requestId, kind, tool, options, title } = event.payload;
  const own = Object.values(CORE_ASKS).some((prefix) => requestId.startsWith(prefix));
  const allow = options.find((option) => option.kind === "allow_once");
  const deny = options.find((option) => option.kind === "reject_once");
  if (own || tool !== undefined || !LOW_RISK.has(kind ?? "other") || !allow || !deny) {
    return { body: title };
  }
  return {
    body: title,
    hint: "Tap Allow or Deny, or reply with why not.",
    answers: {
      ...base,
      choices: [
        {
          id: "0",
          label: "Allow",
          answer: permissionAnswer(requestId, allow.optionId),
          done: "Allowed",
        },
        {
          id: "1",
          label: "Deny",
          answer: permissionAnswer(requestId, deny.optionId),
          done: "Denied",
        },
      ],
      reply: { kind: "deny", optionId: deny.optionId },
    },
  } satisfies Described;
}

function question(event: Extract<Asked, { type: "question.requested" }>, base: Base): Described {
  const { requestId, questions } = event.payload;
  const [only] = questions;
  if (only === undefined || questions.length > 1) {
    return { body: questions.map((one) => one.text).join("\n") };
  }
  const options = only.multiSelect ? [] : only.options.slice(0, MOST_CHOICES);
  return {
    body: only.text,
    hint:
      options.length === 0 ? "Reply with your answer." : "Tap an answer or reply with your own.",
    answers: {
      ...base,
      choices: options.map((option, index) => ({
        id: String(index),
        label: option.label,
        answer: {
          type: "answerQuestion",
          requestId,
          answers: [{ questionId: only.questionId, selected: [option.label] }],
        },
        done: `Answered: ${option.label}`,
      })),
      reply: { kind: "question", questionId: only.questionId },
    },
  };
}

// A plan that makes a new department waits at the computer, where its place is chosen.
function plan(event: Extract<Asked, { type: "plan.requested" }>, base: Base): Described {
  const { requestId, pieces } = event.payload;
  const body = pieces.map((piece, index) => `${index + 1}. ${piece.title}`).join("\n");
  if (pieces.some((piece) => "newDepartment" in piece.department)) return { body };
  return {
    body,
    hint: "Tap Approve, or reply with what to change.",
    answers: {
      ...base,
      choices: [
        {
          id: "0",
          label: "Approve",
          answer: {
            type: "answerPlan",
            requestId,
            answer: { outcome: "approved", pieces: pieces as ApprovedPiece[] },
          },
          done: "Approved",
        },
      ],
      reply: { kind: "revise" },
    },
  };
}

// The ask as it goes out: who asks and what, in its own words, with the answers it may take where
// the service can carry them back.
export function askMessage(event: Asked, who: string, title: string, twoWay: boolean): Queued {
  const base = { sessionId: event.sessionId, requestId: event.payload.requestId };
  const { body, hint, answers }: Described =
    event.type === "permission.requested"
      ? permission(event, base)
      : event.type === "question.requested"
        ? question(event, base)
        : plan(event, base);
  const footer = !twoWay
    ? "Answer it in Office Town."
    : answers !== undefined && hint !== undefined
      ? hint
      : ON_COMPUTER;
  return {
    kind: "ask",
    title: `${title}: ${who} needs you`,
    text: `${body}\n\n${footer}`,
    ...(twoWay && answers !== undefined ? { ask: answers } : {}),
  };
}
