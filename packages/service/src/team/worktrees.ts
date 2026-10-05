import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord, DepartmentRecord, EnvironmentSpec } from "@office-town/contract";
import { environmentPath, runCommand } from "@office-town/harness";
import { settingsOf } from "../agents/agents.ts";
import { inFolders } from "../agents/options.ts";
import type { TeamContext } from "./members.ts";
import { workspaceFolders } from "./members.ts";

const WORKTREES = "worktrees";
// Characters a branch or folder name should not carry.
const UNSAFE = /[^a-z0-9-]+/g;

export class GitError extends Error {
  constructor(what: string, detail: string) {
    super(`git could not ${what}: ${detail.trim()}`);
    this.name = "GitError";
  }
}

export function isRepository(folder: string): boolean {
  return existsSync(join(folder, ".git"));
}

async function git(environment: EnvironmentSpec, args: string[], what: string): Promise<string> {
  const result = await runCommand(environment, { binary: "git", args });
  if (result.code !== 0) throw new GitError(what, result.stderr || result.stdout);
  return result.stdout.trim();
}

const slug = (text: string, length: number) =>
  text
    .toLowerCase()
    .replace(UNSAFE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, length) || "work";

// One worktree change at a time per repository: git locks its own files while it works.
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(repository: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(repository) ?? Promise.resolve()).then(work, work);
  queues.set(
    repository,
    next.catch(() => {}),
  );
  return next;
}

// Where a worker works: its own worktree and branch, made from the lead's branch, when the
// workspace is a git repository and the department keeps a branch per worker; otherwise the
// shared workspace. The worktree lives in the data folder, so the user's folder gains only a
// branch. It is made by the git of the worker's own environment, as Windows and WSL git cannot
// read each other's worktrees (D-41).
export async function workerFolders(
  context: TeamContext,
  department: DepartmentRecord,
  worker: AgentRecord,
  taskId: string,
) {
  const folders = workspaceFolders(context.store, department.workspaceId);
  const [main, ...others] = folders;
  if (main === undefined || !department.branchPerWorker || !isRepository(main)) {
    return { ...inFolders(folders), branch: undefined };
  }
  const task = context.store.getTask(taskId);
  const name = slug(worker.name, 40);
  const base = `office-town/${slug(task?.prompt ?? "", 24)}-${taskId.slice(0, 4)}/${name}`;
  const { environment } = settingsOf(context.store, worker);
  const inside = (path: string) => environmentPath(environment, path);
  return inTurn(main, async () => {
    let path = join(context.dataFolder, WORKTREES, taskId, name);
    let branch = base;
    for (let copy = 2; existsSync(path); copy += 1) {
      path = join(context.dataFolder, WORKTREES, taskId, `${name}-${copy}`);
      branch = `${base}-${copy}`;
    }
    await git(
      environment,
      ["-C", inside(main), "worktree", "add", "-b", branch, inside(path), "HEAD"],
      "make a worktree for the worker",
    );
    return { workspacePath: path, additionalPaths: others, branch };
  });
}

interface Worktree {
  path: string;
  environment: EnvironmentSpec;
  main: string;
}

// The worktrees the task's workers worked in, each with the environment that made it.
function worktreesOf({ store, dataFolder }: TeamContext, taskId: string): Worktree[] {
  const root = join(dataFolder, WORKTREES, taskId);
  const task = store.getTask(taskId);
  const department =
    task?.departmentId === undefined ? undefined : store.getDepartment(task.departmentId);
  const main = store.listWorkspaces().find((workspace) => workspace.id === department?.workspaceId)
    ?.folders[0];
  const seen = new Map<string, Worktree>();
  for (const session of store.listSessions(taskId)) {
    const path = session.options.workspacePath;
    if (path === undefined || !path.startsWith(root) || main === undefined) continue;
    seen.set(path, { path, environment: session.options.environment, main });
  }
  return [...seen.values()].filter((worktree) => existsSync(worktree.path));
}

async function remove({ path, environment, main }: Worktree): Promise<void> {
  const inside = (folder: string) => environmentPath(environment, folder);
  try {
    await git(
      environment,
      ["-C", inside(main), "worktree", "remove", "--force", inside(path)],
      "remove a worktree",
    );
  } catch (error) {
    // A repository moved or deleted since cannot remove its worktree; the folder still goes.
    console.error(error);
    rmSync(path, { recursive: true, force: true });
  }
}

// Merged: the branch is in the lead's, and nothing is left uncommitted, which removing would lose.
async function isMerged({ path, environment, main }: Worktree): Promise<boolean> {
  const inside = (folder: string) => environmentPath(environment, folder);
  const changes = await git(
    environment,
    ["-C", inside(path), "status", "--porcelain"],
    "read the worker's changes",
  );
  if (changes !== "") return false;
  const branch = await git(
    environment,
    ["-C", inside(path), "rev-parse", "--abbrev-ref", "HEAD"],
    "read the worker's branch",
  );
  const result = await runCommand(environment, {
    binary: "git",
    args: ["-C", inside(main), "merge-base", "--is-ancestor", branch, "HEAD"],
  });
  return result.code === 0;
}

// A worktree whose branch the lead has merged, and whose worker is not at work, is removed; its
// branch stays.
export async function removeMergedWorktrees(context: TeamContext, taskId: string): Promise<void> {
  const busy = new Set(
    context.store
      .listSessions(taskId)
      .filter((session) => session.status === "starting" || session.status === "running")
      .map((session) => session.options.workspacePath),
  );
  for (const worktree of worktreesOf(context, taskId)) {
    if (busy.has(worktree.path)) continue;
    if (await isMerged(worktree)) await inTurn(worktree.main, () => remove(worktree));
  }
}

// A deleted task takes its worktrees with it; the branches stay in the user's repository.
export async function removeWorktrees(context: TeamContext, taskId: string): Promise<void> {
  for (const worktree of worktreesOf(context, taskId)) {
    await inTurn(worktree.main, () => remove(worktree));
  }
  rmSync(join(context.dataFolder, WORKTREES, taskId), { recursive: true, force: true });
}

// Checks a team's worktrees whenever one of its agents finishes a turn or ends: the lead may have
// merged a branch, or a worker may have left its worktree free to remove.
export function cleanUpWorktrees(context: TeamContext): void {
  const checking = new Map<string, Promise<void>>();
  context.registry.subscribe(({ event }) => {
    if (event.type !== "turn.ended" && event.type !== "session.ended") return;
    const taskId = context.store.getSession(event.sessionId)?.taskId;
    if (taskId === undefined || context.store.getTask(taskId)?.departmentId === undefined) return;
    const before = checking.get(taskId) ?? Promise.resolve();
    const next = before
      .then(() => removeMergedWorktrees(context, taskId))
      .catch((error: unknown) => console.error("Could not clean up worktrees.", error));
    checking.set(taskId, next);
  });
}
