import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionOptions, WorkspaceRecord } from "@office-town/contract";
import type { Store } from "./store/store.ts";

// Characters Windows refuses in a file name, and control characters.
const UNSAFE_IN_NAME = /[<>:"/\\|?*\p{Cc}]/gu;
const NAME_WORDS = 6;
const NAME_LENGTH = 50;

// Where a task's agents work: the first folder, then the others they may edit, then read only.
export interface TaskFolders {
  workspacePath: string;
  additionalPaths: string[];
  readOnlyPaths: string[];
}

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
export function foldersForTask(store: Store, workspaceId: string, prompt: string): TaskFolders {
  const { kind, folders } = store.useWorkspace(workspaceId);
  const [main, ...others] = folders;
  if (main === undefined) throw new FolderNotFoundError(workspaceId);
  requireFolders(others.map((folder) => folder.path));
  if (kind === "scratch") mkdirSync(main.path, { recursive: true });
  else requireFolders([main.path]);
  return {
    workspacePath: kind === "scratch" ? createTaskFolder(main.path, prompt, new Date()) : main.path,
    additionalPaths: others.filter((folder) => folder.access === "edit").map((f) => f.path),
    readOnlyPaths: others.filter((folder) => folder.access === "read").map((f) => f.path),
  };
}

// Named by the day and the prompt's first words, so the user can tell the folders apart.
function createTaskFolder(parent: string, prompt: string, now: Date): string {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  const words = prompt
    .replace(UNSAFE_IN_NAME, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NAME_WORDS)
    .join(" ");
  // By character, so an emoji is never split. Windows drops a trailing dot or space from a name.
  const short = Array.from(words)
    .slice(0, NAME_LENGTH)
    .join("")
    .replace(/[. ]+$/, "");
  const name = short === "" ? day : `${day} ${short}`;
  for (let copy = 1; ; copy += 1) {
    const folder = join(parent, copy === 1 ? name : `${name} (${copy})`);
    try {
      mkdirSync(folder);
      return folder;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
