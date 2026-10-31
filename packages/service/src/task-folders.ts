import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionOptions, WorkspaceRecord } from "@office-town/contract";
import type { Store } from "./store/store.ts";

// Where a task's agents work: the first folder, then the others they may edit, then read only.
export interface TaskFolders {
  workspacePath: string;
  additionalPaths: string[];
  readOnlyPaths: string[];
  // The first folder is this task's own, made for it in a Scratch workspace.
  scratch?: boolean;
}

// In what a Scratch task's agents read first, so one folder stays one folder.
export const SCRATCH_ASK =
  "This task has its own folder, the one you start in. Put every file in it: never make a folder beside it or write outside it.";

export class FolderNotFoundError extends Error {
  constructor(folder: string) {
    super(`The folder "${folder}" does not exist.`);
    this.name = "FolderNotFoundError";
  }
}

export function requireFolders(folders: string[]): void {
  for (const folder of folders) {
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      throw new FolderNotFoundError(folder);
    }
  }
}

// A resumed session runs where it started, so its folders must still be there.
export function requireSessionFolders({
  workspacePath,
  additionalPaths = [],
}: SessionOptions): void {
  requireFolders(
    workspacePath === undefined ? additionalPaths : [workspacePath, ...additionalPaths],
  );
}

export const pathsOf = (workspace: WorkspaceRecord): string[] =>
  workspace.folders.map((folder) => folder.path);

export function workspacePaths(store: Store, workspaceId: string): string[] {
  const workspace = store.getWorkspace(workspaceId);
  return workspace === undefined ? [] : pathsOf(workspace);
}

// A Scratch workspace's first folder is made when a task needs it.
export function requireWorkspaceFolders({
  kind,
  folders,
}: Pick<WorkspaceRecord, "kind" | "folders">) {
  requireFolders(folders.slice(kind === "scratch" ? 1 : 0).map((folder) => folder.path));
}

// Scratch gives each task a new folder, so tasks never overwrite each other; its parent is made if
// missing, as the default one is only made when first needed.
export function foldersForTask(store: Store, workspaceId: string): TaskFolders {
  const { kind, folders } = store.useWorkspace(workspaceId);
  const [main, ...others] = folders;
  if (main === undefined) throw new FolderNotFoundError(workspaceId);
  requireFolders(others.map((folder) => folder.path));
  if (kind === "scratch") mkdirSync(main.path, { recursive: true });
  else requireFolders([main.path]);
  return {
    workspacePath: kind === "scratch" ? createTaskFolder(main.path, new Date()) : main.path,
    additionalPaths: others.filter((folder) => folder.access === "edit").map((f) => f.path),
    readOnlyPaths: others.filter((folder) => folder.access === "read").map((f) => f.path),
    ...(kind === "scratch" ? { scratch: true } : {}),
  };
}

// The time and an id, never the prompt: an agent took a cut-off sentence for a wrong name and made
// the full one beside it. The app shows an alias (`scratchAlias`).
function createTaskFolder(parent: string, now: Date): string {
  const two = (part: number) => String(part).padStart(2, "0");
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}-${two(now.getMinutes())}`;
  const folder = join(parent, `${day} ${time} ${randomUUID().slice(0, 8)}`);
  mkdirSync(folder);
  return folder;
}
