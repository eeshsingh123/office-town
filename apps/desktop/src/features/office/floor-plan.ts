import type { SessionRecord } from "@office-town/contract";
import { isOpen } from "../../store/records.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface Seat {
  desk: Point;
  // The centre of the agent sitting at the desk.
  agent: Point;
}

// A department's room, the open floor for agents working alone, or the guest desk for second
// opinions (MODULES M4.9).
export type RoomKind = "department" | "open" | "guest";

export interface RoomSpec {
  // A department's id, or the kind for the open floor and the guest desk.
  id: string;
  kind: RoomKind;
  desks: number;
}

export interface Room extends RoomSpec {
  rect: Rect;
  // One per desk, filled in order.
  seats: Seat[];
}

export interface FloorPlan {
  width: number;
  height: number;
  rooms: Room[];
  start: Point;
}

export const DESK = { width: 64, height: 34 };
// How near the player must stand to talk to an agent.
export const REACH = 95;

const MAX_COLUMNS = 3;
const PITCH = { x: 150, y: 140 };
const MARGIN = 30;
const INNER_WIDTH = 780;
const GAP = { x: 40, y: 50 };
// Space above a room's first desk, for its sign, goal and usage, and below its last desk.
const DESK_TOP = 160;
const DESK_BOTTOM = 34;
const CORRIDOR = 90;

function placeRoom(spec: RoomSpec, at: Point): Room {
  const columns = Math.min(MAX_COLUMNS, Math.max(1, spec.desks));
  const rows = Math.max(1, Math.ceil(spec.desks / columns));
  const width = columns * PITCH.x + 70;
  const height = DESK_TOP + (rows - 1) * PITCH.y + DESK.height + DESK_BOTTOM;
  const left = at.x + (width - ((columns - 1) * PITCH.x + DESK.width)) / 2;
  const seats = Array.from({ length: Math.max(1, spec.desks) }, (_, index) => {
    const desk = {
      x: left + (index % columns) * PITCH.x,
      y: at.y + DESK_TOP + Math.floor(index / columns) * PITCH.y,
    };
    return { desk, agent: { x: desk.x + DESK.width / 2, y: desk.y - 46 } };
  });
  return { ...spec, rect: { ...at, width, height }, seats };
}

// Rooms in the order given, packed into rows left to right; the player starts in the corridor
// below them. Departments are rooms on the one floor M3 started (D-35).
export function floorPlan(specs: readonly RoomSpec[]): FloorPlan {
  const rooms: Room[] = [];
  let at = { x: MARGIN, y: MARGIN + 20 };
  let rowBottom = at.y;
  for (const spec of specs) {
    let room = placeRoom(spec, at);
    if (at.x > MARGIN && at.x + room.rect.width > MARGIN + INNER_WIDTH) {
      at = { x: MARGIN, y: rowBottom + GAP.y };
      room = placeRoom(spec, at);
    }
    rooms.push(room);
    rowBottom = Math.max(rowBottom, room.rect.y + room.rect.height);
    at = { x: room.rect.x + room.rect.width + GAP.x, y: at.y };
  }
  const width = MARGIN * 2 + INNER_WIDTH;
  return {
    width,
    height: rowBottom + CORRIDOR,
    rooms,
    start: { x: width / 2, y: rowBottom + CORRIDOR / 2 },
  };
}

export function clampToFloor(point: Point, plan: FloorPlan, margin = 22): Point {
  return {
    x: Math.min(Math.max(point.x, margin), plan.width - margin),
    y: Math.min(Math.max(point.y, margin), plan.height - margin),
  };
}

const contains = (rect: Rect, { x, y }: Point) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

// The room the player stands in, if any.
export function roomAt(point: Point, plan: FloorPlan): Room | undefined {
  return plan.rooms.find((room) => contains(room.rect, point));
}

// The agent the player stands next to, if any: the nearest one within reach.
export function withinReach<T extends { position: Point }>(player: Point, agents: T[]) {
  let nearest: T | undefined;
  let distance = REACH;
  for (const agent of agents) {
    const away = Math.hypot(agent.position.x - player.x, agent.position.y - player.y);
    if (away <= distance) {
      nearest = agent;
      distance = away;
    }
  }
  return nearest;
}

export function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function inRect<T extends { position: Point }>(rect: Rect, agents: T[]): T[] {
  return agents.filter(({ position }) => contains(rect, position));
}

// The floor shows the agents at work or waiting, and those that finished today; older ones are
// under Tasks.
export function onTheFloor(latest: SessionRecord, waiting: boolean, now = new Date()): boolean {
  if (waiting || isOpen(latest)) return true;
  return new Date(latest.endedAt ?? latest.createdAt).toDateString() === now.toDateString();
}
