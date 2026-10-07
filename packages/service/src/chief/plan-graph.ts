import type { PlanPiece } from "@office-town/contract";

// A piece that ended this way holds every piece after it.
const HOLDS = new Set<PlanPiece["status"]>(["failed", "stopped", "dropped"]);

// Pieces, by key, in an order where each comes after those it waits on; undefined if they wait
// on each other in a circle. Keys outside the list, such as pieces already approved, are taken
// as ready.
export function orderByWaits<Piece extends { key: string; waitsOn: string[] }>(
  pieces: Piece[],
): Piece[] | undefined {
  const keys = new Set(pieces.map((piece) => piece.key));
  const placed = new Set<string>();
  const ordered: Piece[] = [];
  while (ordered.length < pieces.length) {
    const ready = pieces.filter(
      (piece) =>
        !placed.has(piece.key) && piece.waitsOn.every((key) => !keys.has(key) || placed.has(key)),
    );
    if (ready.length === 0) return undefined;
    for (const piece of ready) {
      placed.add(piece.key);
      ordered.push(piece);
    }
  }
  return ordered;
}

// Every piece this one waits on, directly or through others.
export function upstreamOf(piece: PlanPiece, pieces: PlanPiece[]): PlanPiece[] {
  const found = new Map<string, PlanPiece>();
  const visit = (current: PlanPiece) => {
    for (const id of current.waitsOn) {
      const upstream = pieces.find((candidate) => candidate.id === id);
      if (upstream === undefined || found.has(id)) continue;
      found.set(id, upstream);
      visit(upstream);
    }
  };
  visit(piece);
  return [...found.values()];
}

// A waiting piece that can never start as the plan stands: a piece before it failed, was
// stopped or dropped. Only a changed plan frees it.
export function isBlocked(piece: PlanPiece, pieces: PlanPiece[]): boolean {
  return piece.waitsOn.some((id) => {
    const upstream = pieces.find((candidate) => candidate.id === id);
    if (upstream === undefined || HOLDS.has(upstream.status)) return true;
    return upstream.status === "waiting" && isBlocked(upstream, pieces);
  });
}
