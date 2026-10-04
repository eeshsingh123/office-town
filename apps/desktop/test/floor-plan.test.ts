import type { SessionRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import {
  clampToRoom,
  floorPlan,
  inRect,
  onTheFloor,
  REACH,
  rectFrom,
  withinReach,
} from "../src/features/office/floor-plan.ts";

const agents = [
  { id: "a", position: { x: 100, y: 100 } },
  { id: "b", position: { x: 300, y: 100 } },
  { id: "c", position: { x: 300, y: 400 } },
];

describe("floor plan", () => {
  it("keeps a spare desk for the next agent and keeps the player inside the room", () => {
    const plan = floorPlan(6);
    expect(plan.seats.length).toBeGreaterThan(6);
    expect(floorPlan(0).seats.length).toBe(floorPlan(5).seats.length);
    const { room } = plan;
    const outside = clampToRoom({ x: -50, y: room.y + room.height + 50 }, plan);
    expect(outside.x).toBeGreaterThan(room.x);
    expect(outside.y).toBeLessThan(room.y + room.height);
  });

  it("finds the nearest agent within reach, and the agents inside a dragged box", () => {
    expect(withinReach({ x: 290, y: 110 }, agents)?.id).toBe("b");
    expect(withinReach({ x: 200, y: 250 }, agents)).toBeUndefined();
    expect(withinReach({ x: 100 + REACH, y: 100 }, agents)?.id).toBe("a");

    // A box can be dragged in any direction.
    const box = rectFrom({ x: 350, y: 450 }, { x: 250, y: 50 });
    expect(inRect(box, agents).map((agent) => agent.id)).toEqual(["b", "c"]);
  });

  it("shows open and waiting agents, and those that finished today", () => {
    const now = new Date("2026-10-04T18:00:00");
    const session = (status: SessionRecord["status"], endedAt?: string) =>
      ({ status, createdAt: "2026-10-01T09:00:00", ...(endedAt && { endedAt }) }) as SessionRecord;

    expect(onTheFloor(session("running"), false, now)).toBe(true);
    expect(onTheFloor(session("exited", "2026-10-04T08:00:00"), false, now)).toBe(true);
    expect(onTheFloor(session("exited", "2026-10-03T23:00:00"), false, now)).toBe(false);
    expect(onTheFloor(session("interrupted"), true, now)).toBe(true);
  });
});
