import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { placeRoom } from "../../store/live.ts";
import { dragTarget, type FloorPlan, GRID, movable, type Point, type Rect } from "./floor-plan.ts";

// A press on a sign that moves less than this is a click.
const DRAG_START = 4;
const STEPS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export interface RoomMove {
  id: string;
  from: Rect;
  at: Point;
  // Where the pointer went down; none when the keyboard moves the room.
  pointer?: Point;
  // Past the first few pixels of a pointer drag.
  lifted: boolean;
}

function save({ id, from, at }: RoomMove): void {
  if (at.x === from.x && at.y === from.y) return;
  placeRoom(id, at).catch((error: unknown) =>
    console.error("Could not keep the room's place.", error),
  );
}

// Dragging a room by its sign, or moving it with Alt and the arrow keys while the sign has focus.
// The room stops at the last free spot it passed and keeps its place once let go.
export function useRoomDrag(plan: FloorPlan) {
  const [move, setMove] = useState<RoomMove>();
  const dragged = useRef(false);

  const target = (id: string, from: Rect, to: Point) => {
    const others = plan.rooms.filter((room) => room.id !== id && movable(room.kind));
    return dragTarget(
      from,
      to,
      others.map((room) => room.rect),
      plan,
    );
  };

  const handlers = (id: string, rect: Rect) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragged.current = false;
      const pointer = { x: event.clientX, y: event.clientY };
      setMove({ id, from: rect, at: { x: rect.x, y: rect.y }, pointer, lifted: false });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (move?.id !== id || move.pointer === undefined) return;
      const dx = event.clientX - move.pointer.x;
      const dy = event.clientY - move.pointer.y;
      if (!move.lifted && Math.hypot(dx, dy) < DRAG_START) return;
      const at = target(id, move.from, { x: move.from.x + dx, y: move.from.y + dy }) ?? move.at;
      setMove({ ...move, at, lifted: true });
    },
    onPointerUp: () => {
      if (move?.id !== id) return;
      if (move.lifted) {
        dragged.current = true;
        save(move);
      }
      setMove(undefined);
    },
    onPointerCancel: () => setMove(undefined),
    onLostPointerCapture: () => {
      if (move?.id === id && move.pointer !== undefined) setMove(undefined);
    },
    // A keyboard move is kept when the sign loses focus before Alt is let go.
    onBlur: () => {
      if (move?.id !== id || move.pointer !== undefined) return;
      save(move);
      setMove(undefined);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step = STEPS[event.key];
      if (!event.altKey || step === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const current =
        move?.id === id ? move : { id, from: rect, at: { x: rect.x, y: rect.y }, lifted: false };
      const to = { x: current.at.x + step.x * GRID, y: current.at.y + step.y * GRID };
      setMove({ ...current, at: target(id, current.from, to) ?? current.at });
    },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (move?.id !== id || move.pointer !== undefined) return;
      if (event.key !== "Alt" && STEPS[event.key] === undefined) return;
      event.stopPropagation();
      save(move);
      setMove(undefined);
    },
  });

  // The click that ends a drag does not count as a click on the sign.
  const wasClick = () => {
    const was = dragged.current;
    dragged.current = false;
    return !was;
  };
  return { move, handlers, wasClick };
}
