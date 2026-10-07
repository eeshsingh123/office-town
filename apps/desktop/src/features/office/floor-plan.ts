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

// A department's room, the chief's office, the open floor for agents working alone, or the guest
// desk for second opinions (MODULES M4.9).
export type RoomKind = "department" | "chief" | "open" | "guest";

export interface RoomSpec {
  // A department's id, or the kind for the chief's office, the open floor and the guest desk.
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
// Dragged rooms land on this grid.
export const GRID = 10;

const MAX_COLUMNS = 3;
const PITCH = { x: 150, y: 140 };
const MARGIN = 30;
const INNER_WIDTH = 780;
const FLOOR_WIDTH = MARGIN * 2 + INNER_WIDTH;
const TOP = MARGIN + 20;
const GAP = { x: 40, y: 50 };
// Space above a room's first desk, for its sign, goal and usage, and below its last desk. The
// chief's office has no goal or usage lines.
const DESK_TOP = 160;
const CHIEF_DESK_TOP = 90;
const DESK_BOTTOM = 34;
const CORRIDOR = 90;
// Room for the plan's links between the chief's office and the rooms below it.
const CHIEF_GAP = 70;
// Rooms keep this far apart, so a sign never sits on the room above it.
const ROOM_GAP = 20;

// Rooms the user can drag; the open floor and the guest desk are always placed for them.
export const movable = (kind: RoomKind) => kind === "department" || kind === "chief";

function placeRoom(spec: RoomSpec, at: Point): Room {
  const columns = Math.min(MAX_COLUMNS, Math.max(1, spec.desks));
  const rows = Math.max(1, Math.ceil(spec.desks / columns));
  const top = spec.kind === "chief" ? CHIEF_DESK_TOP : DESK_TOP;
  const width = columns * PITCH.x + 70;
  const height = top + (rows - 1) * PITCH.y + DESK.height + DESK_BOTTOM;
  const left = at.x + (width - ((columns - 1) * PITCH.x + DESK.width)) / 2;
  const seats = Array.from({ length: Math.max(1, spec.desks) }, (_, index) => {
    const desk = {
      x: left + (index % columns) * PITCH.x,
      y: at.y + top + Math.floor(index / columns) * PITCH.y,
    };
    return { desk, agent: { x: desk.x + DESK.width / 2, y: desk.y - 46 } };
  });
  return { ...spec, rect: { ...at, width, height }, seats };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + ROOM_GAP &&
    b.x < a.x + a.width + ROOM_GAP &&
    a.y < b.y + b.height + ROOM_GAP &&
    b.y < a.y + a.height + ROOM_GAP
  );
}

const bottomOf = (rooms: readonly Room[]) =>
  Math.max(0, ...rooms.map(({ rect }) => rect.y + rect.height));

// Packs rooms into rows left to right from `top`, stepping past the rooms already placed.
function pack(specs: readonly RoomSpec[], placed: readonly Room[], top: number): Room[] {
  const rooms: Room[] = [];
  let at = { x: MARGIN, y: top };
  let rowBottom = top;
  for (const spec of specs) {
    let room = placeRoom(spec, at);
    for (;;) {
      if (at.x > MARGIN && room.rect.x + room.rect.width > MARGIN + INNER_WIDTH) {
        at = { x: MARGIN, y: rowBottom + GAP.y };
      } else {
        const blocker = [...placed, ...rooms].find((other) => overlaps(room.rect, other.rect));
        if (blocker === undefined) break;
        rowBottom = Math.max(rowBottom, blocker.rect.y + blocker.rect.height);
        at = { x: blocker.rect.x + blocker.rect.width + GAP.x, y: at.y };
      }
      room = placeRoom(spec, at);
    }
    rooms.push(room);
    rowBottom = Math.max(rowBottom, room.rect.y + room.rect.height);
    at = { x: room.rect.x + room.rect.width + GAP.x, y: at.y };
  }
  return rooms;
}

// The chief's office sits at the top centre and departments in rows below it, in the order given;
// a room the user dragged stays where they put it, unless a room moved before it already took that
// spot, as when a team grew. Every other room keeps the place it would have with no room moved,
// unless a moved room took it; then it steps past. The open floor and the
// guest desk come after every room, so a moved room never covers them, and the player starts in
// the corridor below. Departments are rooms on the one floor M3 started (D-35, D-49).
export function floorPlan(
  specs: readonly RoomSpec[],
  positions: Readonly<Record<string, Point>> = {},
): FloorPlan {
  const movedTo = (spec: RoomSpec) => (movable(spec.kind) ? positions[spec.id] : undefined);
  const rooms: Room[] = [];
  for (const spec of specs) {
    const at = movedTo(spec);
    if (at === undefined) continue;
    const room = placeRoom(spec, at);
    if (!rooms.some((other) => overlaps(room.rect, other.rect))) rooms.push(room);
  }
  const moved = new Set(rooms.map((room) => room.id));
  const homes: Room[] = [];
  let top = TOP;
  const chief = specs.find((spec) => spec.kind === "chief");
  if (chief !== undefined) {
    const { width } = placeRoom(chief, { x: 0, y: top }).rect;
    const office = placeRoom(chief, { x: (FLOOR_WIDTH - width) / 2, y: top });
    homes.push(office);
    top += office.rect.height + CHIEF_GAP;
  }
  homes.push(
    ...pack(
      specs.filter((spec) => spec.kind === "department"),
      [],
      top,
    ),
  );
  const displaced: RoomSpec[] = [];
  for (const home of homes.filter((one) => !moved.has(one.id))) {
    if (rooms.some((room) => overlaps(room.rect, home.rect))) displaced.push(home);
    else rooms.push(home);
  }
  rooms.push(...pack(displaced, rooms, top));
  const fixed = specs.filter((spec) => !movable(spec.kind));
  rooms.push(...pack(fixed, rooms, rooms.length === 0 ? top : bottomOf(rooms) + GAP.y));
  const bottom = Math.max(top, bottomOf(rooms));
  const order = new Map(specs.map((spec, index) => [spec.id, index]));
  rooms.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    width: Math.max(FLOOR_WIDTH, ...rooms.map(({ rect }) => rect.x + rect.width + MARGIN)),
    height: bottom + CORRIDOR,
    rooms,
    start: { x: FLOOR_WIDTH / 2, y: bottom + CORRIDOR / 2 },
  };
}

// Where a dragged room lands: on the grid, inside the floor and clear of the other rooms; none when
// that spot is taken, so the room stays at the last free spot it passed.
export function dragTarget(
  room: Rect,
  to: Point,
  others: readonly Rect[],
  floor: { width: number; height: number },
): Point | undefined {
  const snap = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(Math.round(value / GRID) * GRID, max));
  const at = {
    x: snap(to.x, GRID, Math.floor((floor.width - room.width) / GRID) * GRID),
    y: snap(to.y, 2 * GRID, Math.floor((floor.height - room.height) / GRID) * GRID),
  };
  return others.some((other) => overlaps({ ...room, ...at }, other)) ? undefined : at;
}

export function clampToFloor(point: Point, plan: FloorPlan, margin = 22): Point {
  return {
    x: Math.min(Math.max(point.x, margin), plan.width - margin),
    y: Math.min(Math.max(point.y, margin), plan.height - margin),
  };
}

export const contains = (rect: Rect, { x, y }: Point) =>
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
