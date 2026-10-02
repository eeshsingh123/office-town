import {
  adapterCapabilitiesSchema,
  harnessCatalogSchema,
  permissionModeSchema,
  type SessionEvent,
  sessionEventSchema,
  sessionOptionsSchema,
} from "@office-town/contract";
import { beforeAll, describe, expect, it } from "vitest";
import type { Adapter } from "../../src/adapter.ts";
import { type RecordingEntry, type Replay, replay, replayOptions } from "./replay.ts";

type PayloadOf<T extends SessionEvent["type"]> = Extract<SessionEvent, { type: T }>["payload"];

function payloadsOf<T extends SessionEvent["type"]>(events: SessionEvent[], type: T) {
  return events.filter((event) => event.type === type).map((e) => e.payload as PayloadOf<T>);
}

export function describeAdapterConformance(
  adapter: Adapter,
  recordings: Record<string, RecordingEntry[]>,
  catalogOutput: string[],
): void {
  describe(`${adapter.harness} adapter conformance`, () => {
    it("declares valid capabilities", () => {
      expect(adapterCapabilitiesSchema.safeParse(adapter.capabilities).success).toBe(true);
    });

    it.each(permissionModeSchema.options)("builds a command for the %s permission mode", (mode) => {
      const command = adapter.buildCommand({ ...replayOptions, permissionMode: mode });
      expect(command.binary).not.toBe("");
      expect(command.args.every((arg) => typeof arg === "string")).toBe(true);
    });

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

    describe.each(Object.entries(recordings))("replaying %s", (_name, recording) => {
      let events: SessionEvent[];
      let written: Replay["written"];
      beforeAll(async () => {
        ({ events, written } = await replay(adapter, recording));
      });

      it("emits only events that satisfy the contract, in sequence", () => {
        for (const event of events) expect(sessionEventSchema.parse(event)).toEqual(event);
        expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
      });

      it("starts the session once and ends it last", () => {
        expect(payloadsOf(events, "session.started")).toHaveLength(1);
        expect(payloadsOf(events, "session.ended")).toHaveLength(1);
        expect(events.at(-1)?.type).toBe("session.ended");
      });

      it("opens and closes turns in pairs", () => {
        const turns = events.filter(
          (event) => event.type === "turn.started" || event.type === "turn.ended",
        );
        expect(turns.length % 2).toBe(0);
        for (let index = 0; index < turns.length; index += 2) {
          expect(turns[index]?.type).toBe("turn.started");
          expect(turns[index + 1]?.type).toBe("turn.ended");
          expect(turns[index + 1]?.payload.turnId).toBe(turns[index]?.payload.turnId);
        }
      });

      it("only updates and ends actions it started, and ends each at most once", () => {
        const started = payloadsOf(events, "action.started").map((payload) => payload.actionId);
        const updated = payloadsOf(events, "action.updated").map((payload) => payload.actionId);
        const ended = payloadsOf(events, "action.ended").map((payload) => payload.actionId);
        expect(new Set(started).size).toBe(started.length);
        expect(new Set(ended).size).toBe(ended.length);
        expect(started).toEqual(expect.arrayContaining([...updated, ...ended]));
      });

      it("resolves every permission it requests", () => {
        const requested = payloadsOf(events, "permission.requested").map((p) => p.requestId);
        const resolved = payloadsOf(events, "permission.resolved").map((p) => p.requestId);
        expect(resolved.sort()).toEqual(requested.sort());
      });

      it("resolves every question it asks", () => {
        const requested = payloadsOf(events, "question.requested").map((p) => p.requestId);
        const resolved = payloadsOf(events, "question.resolved").map((p) => p.requestId);
        expect(resolved.sort()).toEqual(requested.sort());
      });

      it("reports subscription limits only when it says it can", () => {
        if (adapter.capabilities.usageLimits) return;
        expect(payloadsOf(events, "limits.updated")).toEqual([]);
      });

      it("writes only single-line JSON to the harness", () => {
        for (const line of written) expect(() => JSON.parse(line)).not.toThrow();
      });
    });
  });
}
