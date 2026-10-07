import type { SessionRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import {
  clampToFloor,
  dragTarget,
  floorPlan,
  inRect,
  onTheFloor,
  REACH,
  type Rect,
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

  it("keeps a dragged room where it was put, and lands drags on the grid clear of other rooms", () => {
    const specs = [
      { id: "chief", kind: "chief", desks: 1 },
      { id: "web", kind: "department", desks: 3 },
      { id: "qa", kind: "department", desks: 2 },
      { id: "open", kind: "open", desks: 3 },
    ] as const;
    // QA was moved next to Web before Web's team grew over it, so QA goes back to its own place.
    const plan = floorPlan(specs, {
      web: { x: 900, y: 600 },
      qa: { x: 1000, y: 620 },
      gone: { x: 0, y: 0 },
    });
    const rect = (id: string) => plan.rooms.find((room) => room.id === id)?.rect as Rect;
    expect(rect("web")).toMatchObject({ x: 900, y: 600 });
    expect(rect("qa").x).toBeLessThan(900);
    expect(plan.width).toBeGreaterThan(900 + rect("web").width);
    // The open floor comes after every room, the moved one too.
    expect(rect("open").y).toBeGreaterThan(600 + rect("web").height);

    const floor = { width: plan.width, height: plan.height };
    const qa = rect("qa");
    expect(dragTarget(qa, { x: qa.x + 23, y: qa.y + 7 }, [], floor)).toEqual({
      x: Math.round((qa.x + 23) / 10) * 10,
      y: Math.round((qa.y + 7) / 10) * 10,
    });
    expect(dragTarget(qa, { x: -500, y: 99_999 }, [], floor)).toEqual({
      x: 10,
      y: Math.floor((floor.height - qa.height) / 10) * 10,
    });
    expect(dragTarget(qa, { x: 905, y: 605 }, [rect("web")], floor)).toBeUndefined();
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
