import type { PlanPiece } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { floorPlan } from "../src/features/office/floor-plan.ts";
import { linkPaths, planLinks } from "../src/features/office/plan-links.ts";

const piece = (id: string, fields: Partial<PlanPiece>): PlanPiece => ({
  id,
  taskId: "goal",
  key: id,
  title: id,
  brief: "Do it.",
  waitsOn: [],
  status: "waiting",
  createdAt: "2026-10-07T09:00:00.000Z",
  ...fields,
});

describe("plan links", () => {
  it("draws the plan between room edges in each downstream piece's state", () => {
    const pieces = [
      piece("research", { departmentId: "research", status: "done" }),
      piece("web", { departmentId: "web", waitsOn: ["research"], status: "working" }),
      // A second piece on the same pair of rooms: the stronger state shows.
      piece("copy", { departmentId: "web", waitsOn: ["research"], status: "failed" }),
      piece("qa", { departmentId: "qa", waitsOn: ["web"], status: "queued" }),
      piece("dropped", { departmentId: "qa", status: "dropped" }),
      // Its department does not exist yet.
      piece("ops", { waitsOn: ["web"], status: "waiting" }),
    ];
    const links = planLinks(pieces, "chief");
    expect(links).toEqual([
      { from: "chief", to: "research", state: "done" },
      { from: "research", to: "web", state: "failed" },
      { from: "web", to: "qa", state: "waiting" },
    ]);

    const plan = floorPlan([
      { id: "chief", kind: "chief", desks: 1 },
      { id: "research", kind: "department", desks: 1 },
      { id: "web", kind: "department", desks: 1 },
      { id: "qa", kind: "department", desks: 1 },
    ]);
    const rect = (id: string) => plan.rooms.find((room) => room.id === id)?.rect;
    const ends = linkPaths(links, plan.rooms).map(({ path }) => {
      const numbers = path.match(/-?\d+/g)?.map(Number) ?? [];
      return { start: numbers.slice(0, 2), end: numbers.slice(-2) };
    });
    const chief = rect("chief");
    const research = rect("research");
    const web = rect("web");
    // From the chief's office down: its bottom edge to the room's top edge.
    expect(ends[0]?.start[1]).toBe((chief?.y ?? 0) + (chief?.height ?? 0));
    expect(ends[0]?.end[1]).toBe(research?.y);
    // Rooms side by side join bottom to bottom.
    expect(ends[1]?.start[1]).toBe((research?.y ?? 0) + (research?.height ?? 0));
    expect(ends[1]?.end[1]).toBe((web?.y ?? 0) + (web?.height ?? 0));
  });
});
