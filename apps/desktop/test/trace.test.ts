import type { SessionEvent, SessionEventBody } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { applyEvents, emptyTrace, requestKey, type TraceAction } from "../src/trace/trace.ts";

const SESSION = "session-1";

let count = 0;

// Stored events take their sequence as their position; text fragments get none, as in the core's stream.
function stream(...bodies: SessionEventBody[]): StreamedEvent[] {
  return bodies.map((body) => {
    count += 1;
    const event = {
      id: `event-${count}`,
      sessionId: SESSION,
      sequence: count,
      timestamp: new Date(Date.UTC(2026, 9, 4, 12, 0, count)).toISOString(),
      ...body,
    } as SessionEvent;
    return body.type === "message.delta" ? { event } : { position: count, event };
  });
}

const started = (actionId: string, extra: object = {}): SessionEventBody => ({
  type: "action.started",
  payload: { actionId, kind: "read", title: `Read ${actionId}`, input: {}, ...extra },
});
const ended = (actionId: string): SessionEventBody => ({
  type: "action.ended",
  payload: { actionId, outcome: "completed", result: "ok" },
});

const work = stream(
  { type: "message", payload: { role: "user", text: "Find the text files" } },
  { type: "turn.started", payload: { turnId: "t1" } },
  {
    type: "plan.updated",
    payload: {
      steps: [
        { id: "1", title: "Look", status: "in_progress" },
        { id: "2", title: "Report", status: "pending" },
      ],
    },
  },
  started("glob", { kind: "delegate", planStepId: "1" }),
  started("inner", { kind: "search", parentActionId: "glob" }),
  ended("inner"),
  { type: "message", payload: { role: "assistant", text: "Found one", parentActionId: "glob" } },
  ended("glob"),
  started("write", { kind: "edit", planStepId: "1" }),
  {
    type: "permission.requested",
    payload: {
      requestId: "p1",
      actionId: "write",
      title: "Write notes.txt",
      input: {},
      options: [{ optionId: "allow", label: "Allow once", kind: "allow_once" }],
    },
  },
  { type: "permission.resolved", payload: { requestId: "p1", outcome: "allowed" } },
  { type: "message.delta", payload: { text: "All " } },
);

describe("trace", () => {
  it("nests sub-agent work and requests under their action, and keeps text being written apart", () => {
    const trace = applyEvents(emptyTrace(SESSION), work);
    const glob = trace.items.get("glob") as TraceAction;

    expect(trace.order).toEqual(["event-1", "glob", "write"]);
    expect(glob).toMatchObject({ status: "completed", children: ["inner", "event-7"] });
    expect(trace.items.get("write")).toMatchObject({ requestIds: [requestKey("p1")] });
    expect(trace.items.get(requestKey("p1"))).toMatchObject({ resolution: { outcome: "allowed" } });
    expect(trace.streaming).toEqual({ "": "All " });

    const done = stream({ type: "message", payload: { role: "assistant", text: "All done" } });
    const finished = applyEvents(trace, done);
    expect(finished.streaming).toEqual({});
    expect(finished.order.at(-1)).toBe(done[0]?.event.id);
  });
});
