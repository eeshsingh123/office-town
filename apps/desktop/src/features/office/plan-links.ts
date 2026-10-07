import type { PieceStatus, PlanPiece } from "@office-town/contract";
import type { Point, Rect, Room } from "./floor-plan.ts";

export type LinkState = "waiting" | "active" | "done" | "failed";

// A link between two rooms of the chief's plan, by room id.
export interface Link {
  from: string;
  to: string;
  state: LinkState;
}

export interface DrawnLink extends Link {
  // An SVG path in floor pixels.
  path: string;
}

const LINK_STATES: Record<PieceStatus, LinkState | undefined> = {
  waiting: "waiting",
  queued: "waiting",
  working: "active",
  done: "done",
  failed: "failed",
  stopped: "failed",
  dropped: undefined,
};
// Weakest first: when several pieces share a pair of rooms, the strongest state shows.
const STRENGTH: LinkState[] = ["done", "waiting", "active", "failed"];
const SPREAD = 34;
const DIP = 40;
const INSET = 18;

// One chief goal's plan as links: from the chief's office to each piece that waits on nothing, and
// from each upstream piece's room to its downstream piece's room, in the downstream piece's state.
// A piece whose department does not exist yet, or that was dropped, draws nothing.
export function planLinks(pieces: readonly PlanPiece[], chiefRoom: string): Link[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const links = new Map<string, Link>();
  for (const piece of pieces) {
    const state = LINK_STATES[piece.status];
    const to = piece.departmentId;
    if (state === undefined || to === undefined) continue;
    const sources =
      piece.waitsOn.length === 0
        ? [chiefRoom]
        : piece.waitsOn.flatMap((id) => {
            const upstream = byId.get(id);
            return upstream?.status === "dropped" ? [] : (upstream?.departmentId ?? []);
          });
    for (const from of sources) {
      if (from === to) continue;
      const key = `${from}>${to}`;
      const known = links.get(key);
      if (known === undefined || STRENGTH.indexOf(state) > STRENGTH.indexOf(known.state)) {
        links.set(key, { from, to, state });
      }
    }
  }
  return [...links.values()];
}

type Edge = "top" | "bottom";

interface End {
  rect: Rect;
  edge: Edge;
  // The centre of the room at the other end, to order ends that share an edge.
  towards: number;
  at: Point;
}

const centreX = (rect: Rect) => rect.x + rect.width / 2;

function endOf(rect: Rect, edge: Edge, other: Rect): End {
  const at = { x: centreX(rect), y: edge === "top" ? rect.y : rect.y + rect.height };
  return { rect, edge, towards: centreX(other), at };
}

// The rule: a link leaves the bottom edge of the upper room for the top edge of the lower one, and
// rooms side by side join bottom to bottom with a curve dipping below them; ends sharing an edge
// spread apart in the order of where they lead.
function edgesOf(from: Rect, to: Rect): [Edge, Edge] {
  if (from.y + from.height <= to.y) return ["bottom", "top"];
  if (to.y + to.height <= from.y) return ["top", "bottom"];
  return ["bottom", "bottom"];
}

export function linkPaths(links: readonly Link[], rooms: readonly Room[]): DrawnLink[] {
  const rects = new Map(rooms.map((room) => [room.id, room.rect]));
  const placed = links.flatMap((link) => {
    const from = rects.get(link.from);
    const to = rects.get(link.to);
    if (from === undefined || to === undefined) return [];
    const [fromEdge, toEdge] = edgesOf(from, to);
    const ends: [End, End] = [endOf(from, fromEdge, to), endOf(to, toEdge, from)];
    return [{ link, ends }];
  });

  const shared = Map.groupBy(
    placed.flatMap(({ ends }) => ends),
    (end) => `${end.rect.x},${end.rect.y},${end.edge}`,
  );
  for (const group of shared.values()) {
    group.sort((a, b) => a.towards - b.towards);
    for (const [index, end] of group.entries()) {
      const { rect } = end;
      const x = centreX(rect) + (index - (group.length - 1) / 2) * SPREAD;
      end.at.x = Math.round(Math.min(Math.max(x, rect.x + INSET), rect.x + rect.width - INSET));
    }
  }

  return placed.map(({ link, ends: [{ at: a, edge }, { at: b, edge: toEdge }] }) => {
    const bend = edge === toEdge ? Math.max(a.y, b.y) + DIP : Math.round((a.y + b.y) / 2);
    return { ...link, path: `M${a.x} ${a.y} C${a.x} ${bend} ${b.x} ${bend} ${b.x} ${b.y}` };
  });
}
