import type { PlanPiece } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import { upstreamOf } from "./plan-graph.ts";

export function departmentNameOf(store: Store, piece: PlanPiece): string {
  const department =
    piece.departmentId === undefined ? undefined : store.getDepartment(piece.departmentId);
  return department?.name ?? piece.newDepartment?.name ?? "A department";
}

function foldersOf(store: Store, piece: PlanPiece): string[] {
  const workspaceId =
    piece.departmentId === undefined
      ? piece.newDepartment?.workspaceId
      : store.getDepartment(piece.departmentId)?.workspaceId;
  return workspaceId === undefined ? [] : (store.getWorkspace(workspaceId)?.folders ?? []);
}

// A piece's department may read, never change, the workspaces of every department before it,
// directly or through others; its own folders stay its own.
export function readOnlyFolders(store: Store, piece: PlanPiece, pieces: PlanPiece[]): string[] {
  const own = new Set(foldersOf(store, piece));
  const upstream = upstreamOf(piece, pieces).flatMap((each) => foldersOf(store, each));
  return [...new Set(upstream)].filter((folder) => !own.has(folder));
}

// The same for any session in a piece's task, such as a worker the lead hands work; none for a
// task that is no piece.
export function readOnlyFoldersOfTask(store: Store, taskId: string): string[] {
  const piece = store.pieceOfTask(taskId);
  if (piece === undefined) return [];
  return readOnlyFolders(store, piece, store.listPieces(piece.taskId));
}
