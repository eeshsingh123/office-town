import type { SessionRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import {
  clampToFloor,
  floorPlan,
  inRect,
  onTheFloor,
  REACH,
  rectFrom,
  roomAt,
  withinReach,
} from "../src/features/office/floor-plan.ts";

const agents = [
  { id: "a", position: { x: 100, y: 100 } },
  { id: "b", position: { x: 300, y: 100 } },
  { id: "c", position: { x: 300, y: 400 } },
];

describe("floor plan", () => {
  it("gives each room its desks without overlap, and keeps the player on the floor", () => {
    const plan = floorPlan([
      { id: "web", kind: "department", desks: 4 },
      { id: "research", kind: "department", desks: 1 },
      { id: "open", kind: "open", desks: 3 },
      { id: "guest", kind: "guest", desks: 2 },
    ]);
    expect(plan.rooms.map((room) => room.seats.length)).toEqual([4, 1, 3, 2]);
    for (const [index, room] of plan.rooms.entries()) {
      expect(room.rect.x + room.rect.width).toBeLessThanOrEqual(plan.width);
      for (const seat of room.seats) expect(roomAt(seat.agent, plan)?.id).toBe(room.id);
      for (const other of plan.rooms.slice(index + 1)) {
        const apart =
          room.rect.x + room.rect.width <= other.rect.x ||
          other.rect.x + other.rect.width <= room.rect.x ||
          room.rect.y + room.rect.height <= other.rect.y ||
          other.rect.y + other.rect.height <= room.rect.y;
        expect(apart).toBe(true);
      }
    }
    expect(roomAt(plan.start, plan)).toBeUndefined();
    const outside = clampToFloor({ x: -50, y: plan.height + 50 }, plan);
    expect(outside.x).toBeGreaterThan(0);
    expect(outside.y).toBeLessThan(plan.height);
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
