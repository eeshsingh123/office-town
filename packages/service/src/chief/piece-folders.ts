import type { PlanPiece } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import { workspacePaths } from "../task-folders.ts";
import { upstreamOf } from "./plan-graph.ts";

export function departmentNameOf(store: Store, piece: PlanPiece): string {
  const department =
    piece.departmentId === undefined ? undefined : store.getDepartment(piece.departmentId);
  return department?.name ?? piece.newDepartment?.name ?? "A department";
}

// Where a piece runs. Before it starts, a folder added since the plan may have replaced Scratch
// (D-82), so a piece named for Scratch follows its department rather than fail.
export function workspaceOf(store: Store, piece: PlanPiece): string | undefined {
  const started =
    piece.pieceTaskId === undefined ? undefined : store.getTask(piece.pieceTaskId)?.workspaceId;
  if (started !== undefined) return started;
  if (piece.departmentId === undefined) return piece.newDepartment?.workspaceId;
  const department = store.getDepartment(piece.departmentId);
  const { workspaceId } = piece;
  if (workspaceId === undefined) return department?.workspaceId;
  const kept = department?.workspaceIds.includes(workspaceId) === true;
  const replaced = !kept && store.getWorkspace(workspaceId)?.kind === "scratch";
  return replaced ? department?.workspaceId : workspaceId;
}

function foldersOf(store: Store, piece: PlanPiece): string[] {
  const workspaceId = workspaceOf(store, piece);
  return workspaceId === undefined ? [] : workspacePaths(store, workspaceId);
}

// Every department before it, directly or through others; its own folders stay writable.
export function readOnlyFolders(store: Store, piece: PlanPiece, pieces: PlanPiece[]): string[] {
  const own = new Set(foldersOf(store, piece));
  const upstream = upstreamOf(piece, pieces).flatMap((each) => foldersOf(store, each));
  return [...new Set(upstream)].filter((folder) => !own.has(folder));
}

// For any session in a piece's task, such as a worker the lead hands work.
export function readOnlyFoldersOfTask(store: Store, taskId: string): string[] {
  const piece = store.pieceOfTask(taskId);
  if (piece === undefined) return [];
  return readOnlyFolders(store, piece, store.listPieces(piece.taskId));
}
