import type { SessionEvent, SessionEventBody } from "@office-town/contract";
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
const result = (agentId: string, text: string): SessionEventBody => ({
  type: "message",
  payload: {
    role: "user",
    text,
    origin: { kind: "result", delegationId: `d-${agentId}`, agentId, outcome: "done" },
  },
});

describe("chat", () => {
  it("threads each worker's result under the delegation it answers, even in a later session", () => {
    const first = trace(
      "lead-1",
      { type: "message", payload: { role: "user", text: "Build the pricing page" } },
      delegate("a1", "@ben-1042", "Build the layout"),
      delegate("a2", "@lena-3381", "Add the endpoint"),
      { type: "message", payload: { role: "assistant", text: "I split it in two." } },
    );
    const resumed = trace("lead-2", result("lena", "Endpoint added"), result("ben", "Layout done"));
    const ids: Record<string, string> = { "@ben-1042": "ben", "@lena-3381": "lena" };

    const items = chatOf([first, resumed], (name) => ids[name]);

    expect(items.map((item) => item.kind)).toEqual(["user", "delegation", "delegation", "agent"]);
    expect(items[1]).toMatchObject({ workerId: "ben", state: "done", result: "Layout done" });
    expect(items[2]).toMatchObject({ workerId: "lena", state: "done", result: "Endpoint added" });
  });
});
