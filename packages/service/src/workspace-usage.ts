import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkspaceRecord, WorkspaceUsage } from "@office-town/contract";
import type { TeamContext } from "./team/members.ts";
import { WORKTREES } from "./team/worktrees.ts";

// Read from git's own files, so a list of workspaces starts no process. A worktree's `.git` is a
// file naming its folder inside the repository's.
export function gitBranch(folder: string): string | undefined {
  const dotGit = join(folder, ".git");
  const stat = statSync(dotGit, { throwIfNoEntry: false });
  if (stat === undefined) return undefined;
  try {
    const gitFolder = stat.isDirectory()
      ? dotGit
      : resolve(
          folder,
          readFileSync(dotGit, "utf8")
            .replace(/^gitdir:\s*/, "")
            .trim(),
        );
    const head = readFileSync(join(gitFolder, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : undefined;
  } catch {
    // A worktree made by WSL git names a Linux path Windows cannot open; the branch is then unknown.
    return undefined;
  }
}

export function workspaceUsage(
  { store, dataFolder }: TeamContext,
  workspace: WorkspaceRecord,
): WorkspaceUsage {
  const { taskCount, recentTasks, openTaskIds } = store.workspaceActivity(workspace.id);
  const checked = workspace.folders.slice(workspace.kind === "scratch" ? 1 : 0);
  const main = workspace.folders[0]?.path;
  const branch = workspace.kind === "folders" && main !== undefined ? gitBranch(main) : undefined;
  const worktrees = new Map<string, WorkspaceUsage["worktrees"][number]>();
  for (const taskId of openTaskIds) {
    const root = join(dataFolder, WORKTREES, taskId);
    for (const { agentId, options } of store.listSessions(taskId)) {
      const path = options.workspacePath;
      if (path === undefined || !path.startsWith(root) || !existsSync(path)) continue;
      const pathBranch = gitBranch(path);
      worktrees.set(path, {
        agentId,
        taskId,
        ...(pathBranch === undefined ? {} : { branch: pathBranch }),
      });
    }
  }
  return {
    workspaceId: workspace.id,
    departmentIds: store
      .listDepartments()
      .filter((department) => department.workspaceIds.includes(workspace.id))
      .map((department) => department.id),
    taskCount,
    recentTasks,
    missingFolders: checked.map((folder) => folder.path).filter((path) => !existsSync(path)),
    ...(branch === undefined ? {} : { branch }),
    worktrees: [...worktrees.values()],
  };
}
