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

// "add" is a dashed room that starts setting up the chief or a new department.
export type RoomKind = "department" | "chief" | "open" | "guest" | "add";

export const ADD_CHIEF = "~add-chief";
export const ADD_DEPARTMENT = "~add-department";

// A department's sub-team: its lead, or the members sharing a role.
export interface TeamGroup {
  label: string;
  desks: number;
}

export interface RoomSpec {
  // A department's id, or the kind for the other rooms.
  id: string;
  kind: RoomKind;
  desks: number;
  // Two or more, filled in order; their desks add up to `desks`.
  groups?: TeamGroup[];
}

// The area a sub-team's desks share inside its room.
export interface Pod {
  label: string;
  desks: number;
  rect: Rect;
}

export interface Room extends RoomSpec {
  rect: Rect;
  // Filled in order.
  seats: Seat[];
  pods?: Pod[];
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
// Room for the sign, goal and usage lines above the first desk; the chief's office has no goal or usage.
const DESK_TOP = 160;
const CHIEF_DESK_TOP = 90;
// A department's sign holds its goal's usage, and each member a token count above its head.
const DEPARTMENT_DESK_TOP = 212;
const DEPARTMENT_PITCH_Y = 180;
const DESK_BOTTOM = 34;
const CORRIDOR = 90;
// Room for the plan's links between the chief's office and the rooms below.
const CHIEF_GAP = 70;
// So a sign never sits on the room above it.
const ROOM_GAP = 20;

// A pod holds the token count above its heads and its name below its desks.
const POD = { side: 40, top: 100, bottom: 34, gap: 16 };
// Pods share a row while they fit four desks across.
const POD_ROW = 4 * PITCH.x + POD.gap;
const POD_ROOM_SIDE = 20;
const MIN_ROOM_WIDTH = PITCH.x + 70;

// The open floor and the guest desk are always placed automatically.
export const movable = (kind: RoomKind) => kind === "department" || kind === "chief";

// Sub-teams as pods, in rows left to right, so a big department reads as its teams.
function placeTeams(spec: RoomSpec, groups: readonly TeamGroup[], at: Point): Room {
  const sized = groups.map((group) => {
    const columns = Math.min(MAX_COLUMNS, Math.max(1, group.desks));
    const rows = Math.ceil(group.desks / columns);
    return {
      group,
      columns,
      width: (columns - 1) * PITCH.x + DESK.width + 2 * POD.side,
      height: POD.top + (rows - 1) * DEPARTMENT_PITCH_Y + DESK.height + POD.bottom,
    };
  });
  const rows: (typeof sized)[] = [];
  for (const pod of sized) {
    const row = rows.at(-1);
    const used = row?.reduce((sum, one) => sum + one.width + POD.gap, 0) ?? 0;
    if (row !== undefined && used + pod.width <= POD_ROW) row.push(pod);
    else rows.push([pod]);
  }
  const pods: Pod[] = [];
  const seats: Seat[] = [];
  let y = at.y + DEPARTMENT_DESK_TOP - POD.top;
  let widest = 0;
  for (const row of rows) {
    let x = at.x + POD_ROOM_SIDE;
    for (const { group, columns, width, height } of row) {
      pods.push({ label: group.label, desks: group.desks, rect: { x, y, width, height } });
      for (let index = 0; index < group.desks; index += 1) {
        const desk = {
          x: x + POD.side + (index % columns) * PITCH.x,
          y: y + POD.top + Math.floor(index / columns) * DEPARTMENT_PITCH_Y,
        };
        seats.push({ desk, agent: { x: desk.x + DESK.width / 2, y: desk.y - 46 } });
      }
      x += width + POD.gap;
    }
    widest = Math.max(widest, x - POD.gap - at.x);
    y += Math.max(...row.map((pod) => pod.height)) + POD.gap;
  }
  const width = Math.max(MIN_ROOM_WIDTH, widest + POD_ROOM_SIDE);
  const height = y - POD.gap + POD_ROOM_SIDE - at.y;
  return { ...spec, rect: { ...at, width, height }, seats, pods };
}

function placeRoom(spec: RoomSpec, at: Point): Room {
  if (spec.groups !== undefined && spec.groups.length > 1) return placeTeams(spec, spec.groups, at);
  const columns = Math.min(MAX_COLUMNS, Math.max(1, spec.desks));
  const rows = Math.max(1, Math.ceil(spec.desks / columns));
  const department = spec.kind === "department";
  const top = spec.kind === "chief" ? CHIEF_DESK_TOP : department ? DEPARTMENT_DESK_TOP : DESK_TOP;
  const pitchY = department ? DEPARTMENT_PITCH_Y : PITCH.y;
  const width = columns * PITCH.x + 70;
  const height = top + (rows - 1) * pitchY + DESK.height + DESK_BOTTOM;
  const left = at.x + (width - ((columns - 1) * PITCH.x + DESK.width)) / 2;
  const seats = Array.from({ length: Math.max(1, spec.desks) }, (_, index) => {
    const desk = {
      x: left + (index % columns) * PITCH.x,
      y: at.y + top + Math.floor(index / columns) * pitchY,
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

// Rows left to right from `top`, stepping past rooms already placed.
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

// A dragged room stays put unless an earlier moved room took the spot; other rooms step past moved ones.
// The open floor and guest desk come last, so a moved room never covers them.
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

// None when the spot is taken, so the room stays at the last free spot it passed.
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

export function roomAt(point: Point, plan: FloorPlan): Room | undefined {
  return plan.rooms.find((room) => contains(room.rect, point));
}

// The nearest agent within reach.
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
