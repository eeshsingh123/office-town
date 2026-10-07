import type { PlanPiece } from "@office-town/contract";
import { useMemo } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { useLoaded } from "../../ui/use-loaded.ts";

// Without dropped pieces. An ended goal's plan is read once; open ones stay in the store.
export function usePlan(taskId: string | undefined): PlanPiece[] {
  const pieces = useApp((state) => state.pieces);
  const held = useMemo(
    () => Object.values(pieces).filter((piece) => piece.taskId === taskId),
    [pieces, taskId],
  );
  const loaded = useLoaded(
    taskId === undefined || held.length > 0 ? undefined : `plan:${taskId}`,
    () => api.getPlan(taskId ?? ""),
  );
  return useMemo(
    () =>
      (held.length > 0 ? held : (loaded.value ?? []))
        .filter((piece) => piece.status !== "dropped")
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [held, loaded.value],
  );
}

export function departmentName(
  piece: PlanPiece,
  departments: Record<string, { name: string }>,
): string {
  const saved = piece.departmentId === undefined ? undefined : departments[piece.departmentId];
  return saved?.name ?? piece.newDepartment?.name ?? "A department";
}
