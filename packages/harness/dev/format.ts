import type { PlanStep, SessionEvent } from "@office-town/contract";

const RESULT_PREVIEW_CHARS = 200;
const STEP_MARKS: Record<PlanStep["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

function preview(text: string): string {
  const singleLine = text.replaceAll(/\s+/g, " ").trim();
  return singleLine.length > RESULT_PREVIEW_CHARS
    ? `${singleLine.slice(0, RESULT_PREVIEW_CHARS)}…`
    : singleLine;
}

function indent(parentActionId: string | undefined): string {
  return parentActionId === undefined ? "" : "    ";
}

export function formatEvent(event: SessionEvent): string {
  switch (event.type) {
    case "session.started":
      return `session  started (${event.payload.model ?? "default model"}, id ${event.payload.harnessSessionId})`;
    case "session.ended":
      return `session  ended: ${event.payload.reason}`;
    case "turn.started":
      return "turn     started";
    case "turn.ended": {
      const { usage, outcome } = event.payload;
      const cost = usage?.costUsd === undefined ? "" : `, $${usage.costUsd.toFixed(4)}`;
      const tokens = usage ? ` (${usage.inputTokens} in, ${usage.outputTokens} out${cost})` : "";
      return `turn     ${outcome}${tokens}`;
    }
    case "message":
      return `${indent(event.payload.parentActionId)}${event.payload.role === "user" ? "you     " : "agent   "} ${event.payload.text}`;
    case "reasoning":
      return `${indent(event.payload.parentActionId)}thinking ${preview(event.payload.text)}`;
    case "plan.updated":
      return event.payload.steps
        .map((step) => `plan     ${STEP_MARKS[step.status]} ${step.title}`)
        .join("\n");
    case "action.started": {
      const { title, kind, planStepId, parentActionId, locations = [] } = event.payload;
      const step = planStepId ? ` (step ${planStepId})` : "";
      return [
        `${indent(parentActionId)}action   ${title} [${kind}]${step}`,
        ...locations.map((location) => `${indent(parentActionId)}         at ${location}`),
      ].join("\n");
    }
    case "action.updated":
      return `action   … ${preview(event.payload.output ?? event.payload.title ?? "")}`;
    case "action.ended":
      return `action   ${event.payload.outcome === "completed" ? "done" : "FAILED"}: ${preview(event.payload.result)}`;
    case "permission.requested":
      return [
        `ASK      ${event.payload.title}`,
        `         ${preview(JSON.stringify(event.payload.input))}`,
        ...event.payload.options.map((option, index) => `         ${index + 1}) ${option.label}`),
      ].join("\n");
    case "permission.resolved":
      return `ASK      ${event.payload.outcome}`;
    case "question.requested":
      return event.payload.questions
        .flatMap((question) => [
          `QUESTION ${question.text}${question.multiSelect ? " (choose one or more)" : ""}`,
          ...question.options.map((option, index) => `         ${index + 1}) ${option.label}`),
        ])
        .join("\n");
    case "question.resolved":
      return `QUESTION ${event.payload.outcome}`;
    case "limits.updated":
      return event.payload.limits
        .map((limit) => `limit    ${limit.label}: ${Math.round(limit.usedFraction * 100)}% used`)
        .join("\n");
    case "error": {
      const detail = event.payload.detail ? `\n         ${preview(event.payload.detail)}` : "";
      return `ERROR    ${event.payload.message}${detail}`;
    }
  }
}
