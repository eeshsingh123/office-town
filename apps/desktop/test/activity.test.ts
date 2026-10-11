import type { SessionEvent, SessionEventBody } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { activityOf } from "../src/trace/activity.ts";
import { applyEvents, emptyTrace } from "../src/trace/trace.ts";

let count = 0;
function trace(...bodies: SessionEventBody[]) {
  const events = bodies.map((body): StreamedEvent => {
    count += 1;
    const event = {
      id: `event-${count}`,
      sessionId: "s1",
      sequence: count,
      timestamp: new Date(Date.UTC(2026, 9, 11, 12, 0, count)).toISOString(),
      ...body,
    } as SessionEvent;
    return { position: count, event };
  });
  return applyEvents(emptyTrace("s1"), events);
}

const ask = (text: string): SessionEventBody => ({
  type: "message",
  payload: { role: "user", text },
});
const start = (
  actionId: string,
  kind: "read" | "search",
  planStepId?: string,
): SessionEventBody => ({
  type: "action.started",
  payload: {
    actionId,
    kind,
    title: `${kind} ${actionId}`,
    input: null,
    ...(planStepId === undefined ? {} : { planStepId }),
  },
});
const end = (actionId: string): SessionEventBody => ({
  type: "action.ended",
  payload: { actionId, outcome: "completed", result: "" },
});

describe("activity", () => {
  it("puts each action under its step and shows what runs now", () => {
    const steps = trace(
      {
        type: "plan.updated",
        payload: {
          steps: [
            { id: "p1", title: "Find sources", status: "completed" },
            { id: "p2", title: "Summarise", status: "in_progress" },
            { id: "p3", title: "Write report", status: "pending" },
          ],
        },
      },
      start("a1", "search", "p1"),
      end("a1"),
      start("a2", "read", "p1"),
      end("a2"),
      start("a3", "read", "p2"),
    );
    expect(
      activityOf([steps], true).map(({ title, state, done, running }) => ({
        title,
        state,
        done,
        running,
      })),
    ).toEqual([
      {
        title: "Find sources",
        state: "done",
        done: "Searched once, read 1 file",
        running: undefined,
      },
      { title: "Summarise", state: "now", done: undefined, running: "read a3" },
      { title: "Write report", state: "next", done: undefined, running: undefined },
    ]);
  });

  it("without steps, groups work under the message that started it", () => {
    const turns = trace(
      {
        type: "message",
        payload: {
          role: "user",
          text: "About the person you work for (Eesh):\nBackend dev\n\nYour task:\nFind AI startups in India.",
          origin: { kind: "brief", summary: "Your profile and its notes, then the task" },
        },
      },
      { type: "turn.started", payload: { turnId: "t1" } },
      start("a1", "search"),
      end("a1"),
      { type: "message", payload: { role: "assistant", text: "Here they are." } },
      { type: "turn.ended", payload: { turnId: "t1", outcome: "completed" } },
      ask("Add health too"),
      { type: "turn.started", payload: { turnId: "t2" } },
      start("a2", "search"),
    );
    expect(
      activityOf([turns], true).map(({ title, state, done, running }) => ({
        title,
        state,
        done,
        running,
      })),
    ).toEqual([
      {
        title: "You asked: Find AI startups in India",
        state: "done",
        done: "Searched once",
        running: undefined,
      },
      { title: "You asked: Add health too", state: "now", done: undefined, running: "search a2" },
    ]);
  });
});
