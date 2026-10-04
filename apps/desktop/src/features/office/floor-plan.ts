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

export interface FloorPlan {
  width: number;
  height: number;
  room: Rect;
  door: Rect;
  // One per desk, filled in order; there are always spare desks.
  seats: Seat[];
  start: Point;
}

export const DESK = { width: 64, height: 34 };
// How near the player must stand to talk to an agent.
export const REACH = 95;

const COLUMNS = 3;
const MIN_ROWS = 2;
const PITCH = { x: 250, y: 240 };
const ROOM = { x: 30, y: 50, width: 780 };
const FIRST_DESK = { x: 130, y: 190 };
const DOOR_WIDTH = 80;

// One open floor (D-35). Departments become rooms on this same plan in M4 and M6.
export function floorPlan(agents: number): FloorPlan {
  const rows = Math.max(MIN_ROWS, Math.ceil((agents + 1) / COLUMNS));
  const room = { ...ROOM, height: 140 + rows * PITCH.y };
  const seats = Array.from({ length: rows * COLUMNS }, (_, index) => {
    const desk = {
      x: FIRST_DESK.x + (index % COLUMNS) * PITCH.x,
      y: FIRST_DESK.y + Math.floor(index / COLUMNS) * PITCH.y,
    };
    return { desk, agent: { x: desk.x + DESK.width / 2, y: desk.y - 46 } };
  });
  const middle = room.x + room.width / 2;
  return {
    width: room.x * 2 + room.width,
    height: room.y + room.height + 70,
    room,
    door: { x: middle - DOOR_WIDTH / 2, y: room.y + room.height - 4, width: DOOR_WIDTH, height: 8 },
    seats,
    start: { x: middle, y: room.y + room.height - 50 },
  };
}

export function clampToRoom(point: Point, { room }: FloorPlan, margin = 22): Point {
  return {
    x: Math.min(Math.max(point.x, room.x + margin), room.x + room.width - margin),
    y: Math.min(Math.max(point.y, room.y + margin), room.y + room.height - margin),
  };
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
  return agents.filter(
    ({ position: { x, y } }) =>
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
  );
}

// The floor shows the agents at work or waiting, and those that finished today; older ones are
// under Tasks.
export function onTheFloor(latest: SessionRecord, waiting: boolean, now = new Date()): boolean {
  if (waiting || isOpen(latest)) return true;
  return new Date(latest.endedAt ?? latest.createdAt).toDateString() === now.toDateString();
}
