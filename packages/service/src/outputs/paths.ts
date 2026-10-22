import { existsSync } from "node:fs";
import { extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import type { SessionRecord } from "@office-town/contract";
import { environmentPath, hostPath } from "@office-town/harness";
import { canonicalPath, inside } from "../autonomy/policy.ts";
import type { Store } from "../store/store.ts";
import type { TeamContext } from "../team/members.ts";
import { mergedPath } from "../team/worktrees.ts";

const WINDOWS_PATH = /^[A-Za-z]:[\\/]|^\\\\/;

// Where the task's agents work: its workspaces and workers' worktrees, never upstream folders
// or attachments, which they may only read.
export function taskRoots(store: Store, taskId: string): string[] {
  const roots = new Set<string>();
  for (const { options } of store.listSessions(taskId)) {
    const readOnly = new Set(options.readOnlyPaths ?? []);
    for (const folder of [options.workspacePath, ...(options.additionalPaths ?? [])]) {
      if (folder !== undefined && !readOnly.has(folder)) roots.add(folder);
    }
  }
  return [...roots];
}

// The deepest root holding the path, so a page's own folder is the one its links reach.
export function rootOf(roots: readonly string[], path: string): string | undefined {
  const real = canonicalPath(path);
  return roots
    .filter((root) => inside(canonicalPath(root), real))
    .sort((a, b) => b.length - a.length)[0];
}

// A path as the agent wrote it, maybe relative or in WSL, as this computer names it.
export function hostPathOf(session: SessionRecord, path: string): string | undefined {
  const { environment, workspacePath } = session.options;
  if (environment.kind === "native" || WINDOWS_PATH.test(path)) {
    if (isAbsolute(path)) return resolve(path);
    return workspacePath === undefined ? undefined : resolve(workspacePath, path);
  }
  if (posix.isAbsolute(path)) return hostPath(environment, path);
  if (workspacePath === undefined) return undefined;
  return hostPath(environment, posix.join(environmentPath(environment, workspacePath), path));
}

// Where the file is now: a worker's file is in the lead's folder once its worktree is merged.
export function currentPath(context: TeamContext, taskId: string, path: string): string {
  return existsSync(path) ? path : (mergedPath(context, taskId, path) ?? path);
}

// With forward slashes, as a link inside a page names it.
export function linkPath(root: string, path: string): string {
  return relative(root, path).split(/[\\/]/).join("/");
}

// A kept version's copy, beside the database.
export function versionFile(
  dataFolder: string,
  outputId: string,
  number: number,
  path: string,
): string {
  return join(dataFolder, "outputs", outputId, `${number}${extname(path).toLowerCase()}`);
}

export function pictureFile(dataFolder: string, outputId: string): string {
  return join(dataFolder, "outputs", outputId, "picture.png");
}
