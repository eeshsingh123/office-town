import type { SessionEvent, SessionEventBody, SessionRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { describeActions, toBlocks } from "../src/trace/blocks.ts";
import { agentState, progressOf } from "../src/trace/progress.ts";
import { applyEvents, emptyTrace, requestKey, type TraceAction } from "../src/trace/trace.ts";

const SESSION = "session-1";

let count = 0;

// Each event gets the next id and sequence; stored ones also take that number as their position,
// while text fragments get none, as in the core's stream.
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

  it("skips events it has already applied, and leaves unchanged items as they were", () => {
    const trace = applyEvents(emptyTrace(SESSION), work.slice(0, 6));
    // A replay overlaps the live stream: the shared events must not apply twice.
    const caughtUp = applyEvents(trace, work);

    expect(caughtUp).toEqual(applyEvents(emptyTrace(SESSION), work));
    expect(caughtUp.items.get("event-1")).toBe(trace.items.get("event-1"));
    expect(caughtUp.items.get("glob")).not.toBe(trace.items.get("glob"));
  });

  it("groups actions by plan step, naming each step once, and sums up a run of actions", () => {
    const batch = stream(
      started("a", { planStepId: "1" }),
      started("b", { planStepId: "1", kind: "execute" }),
      { type: "message", payload: { role: "assistant", text: "Halfway" } },
      started("c", { planStepId: "1" }),
      started("d", { planStepId: "2" }),
    );
    const trace = applyEvents(emptyTrace(SESSION), batch);

    expect(toBlocks(trace)).toEqual([
      { kind: "actions", ids: ["a", "b"], stepId: "1", showsStep: true },
      { kind: "item", id: batch[2]?.event.id },
      { kind: "actions", ids: ["c"], stepId: "1", showsStep: false },
      { kind: "actions", ids: ["d"], stepId: "2", showsStep: true },
    ]);
    const actions = ["a", "b", "c"].map((id) => trace.items.get(id) as TraceAction);
    expect(describeActions(actions)).toBe("Read 2 files, ran 1 command");
  });

  it("tells working from waiting from done for now, and shows the step and current action", () => {
    const session = { status: "running" } as SessionRecord;
    const working = applyEvents(emptyTrace(SESSION), work);
    const idle = applyEvents(
      working,
      stream({ type: "turn.ended", payload: { turnId: "t1", outcome: "completed" } }),
    );

    expect(progressOf(working)).toMatchObject({
      step: { number: 1, title: "Look" },
      stepCount: 2,
      current: { id: "write" },
    });
    expect(agentState(session, working, false)).toBe("working");
    expect(agentState(session, working, true)).toBe("waiting");
    // The write is still open, so the agent is working until it ends.
    expect(agentState(session, idle, false)).toBe("working");
    const closed = applyEvents(idle, stream(ended("write")));
    expect(agentState(session, closed, false)).toBe("idle");
    expect(agentState({ status: "interrupted" } as SessionRecord, closed, false)).toBe(
      "interrupted",
    );
  });
});
