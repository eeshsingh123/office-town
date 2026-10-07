import type { DelegationRecord, SessionEvent, SessionEventBody } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { chatOf } from "../src/features/chat/chat-items.ts";
import { applyEvents, emptyTrace } from "../src/trace/trace.ts";

let count = 0;
function trace(sessionId: string, ...bodies: SessionEventBody[]) {
  const events = bodies.map((body): StreamedEvent => {
    count += 1;
    const event = {
      id: `event-${count}`,
      sessionId,
      sequence: count,
      timestamp: new Date(Date.UTC(2026, 9, 7, 11, 0, count)).toISOString(),
      ...body,
    } as SessionEvent;
    return { position: count, event };
  });
  return applyEvents(emptyTrace(sessionId), events);
}

const delegate = (actionId: string, agent: string, brief: string): SessionEventBody => ({
  type: "action.started",
  payload: {
    actionId,
    kind: "other",
    title: "delegate",
    input: { agent, brief },
    tool: { server: "office-town", name: "delegate" },
  },
});
const failed = (actionId: string): SessionEventBody => ({
  type: "action.ended",
  payload: { actionId, outcome: "failed", result: "No such agent" },
});
const result = (agentId: string, text: string): SessionEventBody => ({
  type: "message",
  payload: {
    role: "user",
    text,
    origin: { kind: "result", delegationId: `d-${agentId}`, agentId, outcome: "done" },
  },
});
const record = (workerAgentId: string, brief: string) =>
  ({ id: `d-${workerAgentId}`, workerAgentId, brief, status: "done" }) as DelegationRecord;

describe("chat", () => {
  it("threads each result under the delegation it answers, never a failed call", () => {
    const first = trace(
      "lead-1",
      { type: "message", payload: { role: "user", text: "Build the pricing page" } },
      delegate("a0", "@ben-1042", "Build the layout"),
      failed("a0"),
      delegate("a1", "@ben-1042", "Build the layout"),
      delegate("a2", "@lena-3381", "Add the endpoint"),
      delegate("a3", "@kim-2001", "Write the copy"),
      { type: "message", payload: { role: "assistant", text: "I split it in three." } },
    );
    const resumed = trace("lead-2", result("lena", "Endpoint added"), result("ben", "Layout done"));
    const ids: Record<string, string> = {
      "@ben-1042": "ben",
      "@lena-3381": "lena",
      "@kim-2001": "kim",
    };

    // Ben's result is matched by its record; Lena's record is not held, so hers falls back to
    // worker order; Kim's thread has neither in an ended goal.
    const items = chatOf([first, resumed], {
      idOfName: (name) => ids[name],
      delegations: [record("ben", "Build the layout")],
      ended: true,
    });

    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "delegation",
      "delegation",
      "delegation",
      "delegation",
      "agent",
    ]);
    expect(items[1]).toMatchObject({ workerId: "ben", state: "failed" });
    expect(items[1]).not.toHaveProperty("result");
    expect(items[2]).toMatchObject({ workerId: "ben", state: "done", result: "Layout done" });
    expect(items[3]).toMatchObject({ workerId: "lena", state: "done", result: "Endpoint added" });
    expect(items[4]).toMatchObject({ workerId: "kim", state: "stopped" });
  });
});
