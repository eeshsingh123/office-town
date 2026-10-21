import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { EnvironmentSpec } from "@office-town/contract";
import { environmentPath, runCommand } from "@office-town/harness";
import type { CheckSandbox, Store } from "../store/store.ts";
import { git, inTurn, isRepository } from "./worktrees.ts";

export const CHECKS = "checks";
// Review copies before D-73; nothing reads them any more.
const OLD_COPIES = "outsourced";
// What a copy leaves out: a fresh look inherits no instructions, and heavy folders get reinstalled.
const LEFT_OUT = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".claude",
  ".opencode",
  ".git",
  "node_modules",
]);
// Windows may hold a file open for a moment after its process ends.
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

export interface MadeSandbox {
  kind: "worktree" | "copy";
  // Where the checker works.
  workPath: string;
  // Beside the work, for the files it reads: the conversation, the context.
  contextPath: string;
  record: CheckSandbox;
}

// The owner's work as it is now, uncommitted changes and new files included, without touching
// the owner's folder or leaving a branch behind. Made by the checker's own git, as Windows and
// WSL git cannot read each other's worktrees (D-41).
async function worktreeOf(environment: EnvironmentSpec, main: string, path: string): Promise<void> {
  const inside = (folder: string) => environmentPath(environment, folder);
  await inTurn(main, async () => {
    const stash = await git(environment, ["-C", inside(main), "stash", "create"], "read changes");
    const at = stash === "" ? "HEAD" : stash;
    await git(
      environment,
      ["-C", inside(main), "worktree", "add", "--detach", inside(path), at],
      "make a worktree for the checker",
    );
  });
  const untracked = await git(
    environment,
    ["-C", inside(main), "ls-files", "--others", "--exclude-standard", "-z"],
    "list new files",
  );
  for (const file of untracked.split("\0").filter((name) => name !== "")) {
    cpSync(join(main, file), join(path, file), { recursive: true });
  }
}

export async function makeSandbox(
  dataFolder: string,
  main: string,
  environment: EnvironmentSpec,
): Promise<MadeSandbox> {
  const root = join(dataFolder, CHECKS, randomUUID());
  const workPath = join(root, "work");
  const contextPath = join(root, "context");
  mkdirSync(contextPath, { recursive: true });
  try {
    if (isRepository(main)) {
      await worktreeOf(environment, main, workPath);
      return {
        kind: "worktree",
        workPath,
        contextPath,
        record: { path: root, repository: main, environment },
      };
    }
    cpSync(main, workPath, {
      recursive: true,
      filter: (copied) => !LEFT_OUT.has(basename(copied)),
    });
    return { kind: "copy", workPath, contextPath, record: { path: root } };
  } catch (error) {
    rmSync(root, REMOVE);
    throw error;
  }
}

// Git forgets the worktree too, so the user's repository keeps no record of it.
export async function removeSandbox({
  path,
  repository,
  environment,
}: CheckSandbox): Promise<void> {
  if (repository !== undefined && environment !== undefined && existsSync(repository)) {
    const inside = (folder: string) => environmentPath(environment, folder);
    const work = join(path, "work");
    await inTurn(repository, async () => {
      if (existsSync(work)) {
        await runCommand(environment, {
          binary: "git",
          args: ["-C", inside(repository), "worktree", "remove", "--force", inside(work)],
        });
      }
      rmSync(path, REMOVE);
      await runCommand(environment, {
        binary: "git",
        args: ["-C", inside(repository), "worktree", "prune"],
      });
    });
    return;
  }
  rmSync(path, REMOVE);
}

export async function removeSandboxesOf(store: Store, taskId?: string): Promise<void> {
  for (const { checkId, sandbox } of store.checkSandboxes(taskId)) {
    try {
      await removeSandbox(sandbox);
      store.sandboxRemoved(checkId);
    } catch (error) {
      console.error("Could not remove a check's sandbox.", error);
    }
  }
}

// At startup no checker runs, so every sandbox goes, even one no record names.
export async function removeAllSandboxes(store: Store, dataFolder: string): Promise<void> {
  await removeSandboxesOf(store);
  const root = join(dataFolder, CHECKS);
  if (existsSync(root)) {
    for (const left of readdirSync(root)) rmSync(join(root, left), REMOVE);
  }
  rmSync(join(dataFolder, OLD_COPIES), REMOVE);
}
