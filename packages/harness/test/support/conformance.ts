import {
  harnessCatalogSchema,
  type SessionEvent,
  sessionEventSchema,
  sessionOptionsSchema,
} from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapter.ts";
import { type ReceivedLine, type RecordingEntry, replay, replayOptions } from "./replay.ts";

type PayloadOf<T extends SessionEvent["type"]> = Extract<SessionEvent, { type: T }>["payload"];

function payloadsOf<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event) => event.type === type).map((e) => e.payload as PayloadOf<T>);
}

const idsOf = (payloads: Array<{ requestId: string }>) =>
  payloads.map((payload) => payload.requestId).sort();

function expectValidEventsInSequence(events: SessionEvent[]): void {
  for (const event of events) expect(sessionEventSchema.parse(event)).toEqual(event);
  expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
}

function expectOneSessionEndedLast(events: SessionEvent[]): void {
  expect(payloadsOf(events, "session.started")).toHaveLength(1);
  expect(payloadsOf(events, "session.ended")).toHaveLength(1);
  expect(events.at(-1)?.type).toBe("session.ended");
}

function expectTurnsInPairs(events: SessionEvent[]): void {
  const turns = events.filter((e) => e.type === "turn.started" || e.type === "turn.ended");
  expect(turns.length % 2).toBe(0);
  for (let index = 0; index < turns.length; index += 2) {
    expect(turns[index]?.type).toBe("turn.started");
    expect(turns[index + 1]?.type).toBe("turn.ended");
    expect(turns[index + 1]?.payload.turnId).toBe(turns[index]?.payload.turnId);
  }
}

function expectActionsStartedBeforeUse(events: SessionEvent[]): void {
  const started = payloadsOf(events, "action.started").map((payload) => payload.actionId);
  const updated = payloadsOf(events, "action.updated").map((payload) => payload.actionId);
  const ended = payloadsOf(events, "action.ended").map((payload) => payload.actionId);
  expect(new Set(started).size).toBe(started.length);
  expect(new Set(ended).size).toBe(ended.length);
  expect(started).toEqual(expect.arrayContaining([...updated, ...ended]));
}

function expectEveryRequestResolved(events: SessionEvent[]): void {
  expect(idsOf(payloadsOf(events, "permission.resolved"))).toEqual(
    idsOf(payloadsOf(events, "permission.requested")),
  );
  expect(idsOf(payloadsOf(events, "question.resolved"))).toEqual(
    idsOf(payloadsOf(events, "question.requested")),
  );
}

function expectFragmentsToAddUp(events: SessionEvent[]): void {
  const streamed = new Map<string, string>();
  for (const event of events) {
    if (event.type === "message.delta" || event.type === "reasoning.delta") {
      const key = `${event.type.replace(".delta", "")}:${event.payload.parentActionId}`;
      streamed.set(key, (streamed.get(key) ?? "") + event.payload.text);
    } else if (event.type === "message" || event.type === "reasoning") {
      const key = `${event.type}:${event.payload.parentActionId}`;
      if (streamed.has(key)) expect(streamed.get(key)).toBe(event.payload.text);
      streamed.delete(key);
    }
  }
}

const isFragment = (event: SessionEvent) =>
  event.type === "message.delta" || event.type === "reasoning.delta";

// The audit copy leaves partial lines out, so a line that reports anything whole is never partial.
function expectFragmentLinesPartial(received: ReceivedLine[]): void {
  for (const { partial, events } of received) {
    if (events.some((event) => !isFragment(event))) expect(partial).toBe(false);
    else if (events.length > 0) expect(partial).toBe(true);
  }
}

// The rules every adapter must keep, checked against real recordings of its harness.
export function describeAdapterConformance(
  adapter: Adapter,
  recordings: Record<string, RecordingEntry[]>,
  catalogOutput: string[],
): void {
  describe(`${adapter.harness} adapter conformance`, () => {
    it("lists its models, each usable as a session's model, exactly when it says it can", () => {
      expect(adapter.catalog !== undefined).toBe(adapter.capabilities.modelList);
      if (adapter.catalog === undefined) return;
      const { models } = harnessCatalogSchema.parse(adapter.catalog.parse(catalogOutput));
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((model) => model.efforts.length > 0)).toBe(adapter.capabilities.effort);
      for (const model of models) {
        const options = { ...replayOptions, model: model.id, effort: model.efforts[0] };
        expect(sessionOptionsSchema.safeParse(options).success).toBe(true);
      }
    });

    it.each(Object.entries(recordings))("keeps the event rules replaying %s", async (_, lines) => {
      const { events, written, lines: reported, received } = await replay(adapter, lines);

      expectValidEventsInSequence(events);
      expectOneSessionEndedLast(events);
      expectTurnsInPairs(events);
      expectActionsStartedBeforeUse(events);
      expectEveryRequestResolved(events);
      expectFragmentsToAddUp(events);
      expectFragmentLinesPartial(received);
      expect(reported.filter((line) => line.direction === "out").map((line) => line.text)).toEqual(
        written,
      );
      if (!adapter.capabilities.usageLimits) {
        expect(payloadsOf(events, "limits.updated")).toEqual([]);
      }
      for (const line of written) expect(() => JSON.parse(line)).not.toThrow();
    });
  });
}
