import type {
  ActionKind,
  Overflow,
  PlanStep,
  SessionEvent,
  UsageLimit,
  UserRequestEvent,
} from "@office-town/contract";
import type { StreamedEvent } from "../api/event-stream.ts";

export interface TraceAction {
  kind: "action";
  id: string;
  actionKind: ActionKind;
  title: string;
  input: unknown;
  locations?: string[];
  status: "running" | "completed" | "failed";
  output?: string;
  result?: string;
  overflow?: Overflow;
  // The `action.ended` event's sequence: the full result is read back by it.
  resultSequence?: number;
  planStepId?: string;
  startedAt: string;
  endedAt?: string;
  // What a sub-agent did inside this action, in order.
  children: string[];
  // Requests the harness raised for this action.
  requestIds: string[];
}

export interface TraceMessage {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface TraceReasoning {
  kind: "reasoning";
  id: string;
  text: string;
}

export interface TraceNotice {
  kind: "notice";
  id: string;
  tone: "quiet" | "error";
  text: string;
  detail?: string;
}

type Resolution = Extract<
  SessionEvent,
  { type: "permission.resolved" | "question.resolved" }
>["payload"];

export interface TraceRequest {
  kind: "request";
  id: string;
  event: UserRequestEvent;
  resolution?: Resolution;
}

export type TraceItem = TraceAction | TraceMessage | TraceReasoning | TraceNotice | TraceRequest;

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface Trace {
  sessionId: string;
  // The last stored event applied; anything at or before it is a repeat.
  position: number;
  // In the order each item first appeared.
  items: Map<string, TraceItem>;
  // Top-level items in the order they happened; nested ones hang off their action.
  order: string[];
  plan: PlanStep[];
  // Text still being written, by the action it belongs to ("" for the agent itself).
  streaming: Record<string, string>;
  turnOpen: boolean;
  lastTurn?: "completed" | "interrupted" | "failed";
  usage: TokenTotals;
  limits: UsageLimit[];
  model?: string;
  ended?: Extract<SessionEvent, { type: "session.ended" }>["payload"];
}

export function emptyTrace(sessionId: string): Trace {
  return {
    sessionId,
    position: 0,
    items: new Map(),
    order: [],
    plan: [],
    streaming: {},
    turnOpen: false,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    limits: [],
  };
}

export const requestKey = (requestId: string) => `request:${requestId}`;

// Applies a batch of events to a trace and returns a new one. Items that change are replaced, so
// a view of an unchanged item can skip drawing it again.
export function applyEvents(trace: Trace, events: readonly StreamedEvent[]): Trace {
  const next: Trace = {
    ...trace,
    items: new Map(trace.items),
    order: [...trace.order],
    streaming: { ...trace.streaming },
  };
  for (const { position, event } of events) {
    if (position !== undefined) {
      if (position <= next.position) continue;
      next.position = position;
    }
    apply(next, event);
  }
  return next;
}

function place(trace: Trace, id: string, parentActionId: string | undefined): void {
  const parent = parentActionId === undefined ? undefined : trace.items.get(parentActionId);
  if (parent?.kind === "action") {
    trace.items.set(parent.id, { ...parent, children: [...parent.children, id] });
  } else {
    trace.order.push(id);
  }
}

function updateAction(trace: Trace, id: string, change: (action: TraceAction) => TraceAction) {
  const action = trace.items.get(id);
  if (action?.kind === "action") trace.items.set(id, change(action));
}

function apply(trace: Trace, event: SessionEvent): void {
  switch (event.type) {
    case "session.started":
      if (event.payload.model !== undefined) trace.model = event.payload.model;
      return;
    case "session.ended":
      trace.ended = event.payload;
      trace.turnOpen = false;
      trace.streaming = {};
      return;
    case "turn.started":
      trace.turnOpen = true;
      return;
    case "turn.ended": {
      const { outcome, usage } = event.payload;
      trace.turnOpen = false;
      trace.lastTurn = outcome;
      if (usage !== undefined) {
        trace.usage = {
          inputTokens: trace.usage.inputTokens + usage.inputTokens,
          outputTokens: trace.usage.outputTokens + usage.outputTokens,
          cachedInputTokens: trace.usage.cachedInputTokens + (usage.cachedInputTokens ?? 0),
        };
      }
      if (outcome !== "completed") {
        const text = outcome === "interrupted" ? "Turn interrupted" : "Turn failed";
        trace.items.set(event.id, { kind: "notice", id: event.id, tone: "quiet", text });
        trace.order.push(event.id);
      }
      return;
    }
    case "message": {
      const { role, text, parentActionId } = event.payload;
      delete trace.streaming[parentActionId ?? ""];
      if (text.trim() === "") return;
      trace.items.set(event.id, { kind: "message", id: event.id, role, text });
      place(trace, event.id, parentActionId);
      return;
    }
    case "reasoning": {
      const { text, parentActionId } = event.payload;
      if (text.trim() === "") return;
      trace.items.set(event.id, { kind: "reasoning", id: event.id, text });
      place(trace, event.id, parentActionId);
      return;
    }
    case "message.delta": {
      const key = event.payload.parentActionId ?? "";
      trace.streaming[key] = (trace.streaming[key] ?? "") + event.payload.text;
      return;
    }
    case "reasoning.delta":
      return;
    case "plan.updated":
      trace.plan = event.payload.steps;
      return;
    case "action.started": {
      const { actionId, kind, title, input, locations, parentActionId, planStepId } = event.payload;
      trace.items.set(actionId, {
        kind: "action",
        id: actionId,
        actionKind: kind,
        title,
        input,
        status: "running",
        startedAt: event.timestamp,
        children: [],
        requestIds: [],
        ...(locations === undefined ? {} : { locations }),
        ...(planStepId === undefined ? {} : { planStepId }),
      });
      place(trace, actionId, parentActionId);
      return;
    }
    case "action.updated": {
      const { title, output, overflow } = event.payload;
      updateAction(trace, event.payload.actionId, (action) => ({
        ...action,
        ...(title === undefined ? {} : { title }),
        ...(output === undefined ? {} : { output }),
        ...(overflow === undefined ? {} : { overflow }),
      }));
      return;
    }
    case "action.ended": {
      const { outcome, result, overflow } = event.payload;
      updateAction(trace, event.payload.actionId, ({ overflow: _, ...action }) => ({
        ...action,
        status: outcome,
        result,
        endedAt: event.timestamp,
        ...(overflow === undefined ? {} : { overflow, resultSequence: event.sequence }),
      }));
      return;
    }
    case "permission.requested":
    case "question.requested": {
      const { requestId, actionId } = event.payload;
      const id = requestKey(requestId);
      trace.items.set(id, { kind: "request", id, event });
      const action = actionId === undefined ? undefined : trace.items.get(actionId);
      if (action?.kind === "action") {
        trace.items.set(action.id, { ...action, requestIds: [...action.requestIds, id] });
      } else {
        trace.order.push(id);
      }
      return;
    }
    case "permission.resolved":
    case "question.resolved": {
      const id = requestKey(event.payload.requestId);
      const request = trace.items.get(id);
      if (request?.kind === "request")
        trace.items.set(id, { ...request, resolution: event.payload });
      return;
    }
    case "limits.updated":
      trace.limits = event.payload.limits;
      return;
    case "error": {
      const { message, detail, fatal } = event.payload;
      trace.items.set(event.id, {
        kind: "notice",
        id: event.id,
        tone: fatal ? "error" : "quiet",
        text: message,
        ...(detail === undefined ? {} : { detail }),
      });
      trace.order.push(event.id);
      return;
    }
  }
}
