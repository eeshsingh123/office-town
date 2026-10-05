import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Core, eventually, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };
const git = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", folder, ...args], {
    encoding: "utf8",
  }).trim();

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-worktrees-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("worktrees", () => {
  it("gives each worker in a git workspace its own worktree and branch, and removes them once merged or with the task", async () => {
    const project = join(directory, "project");
    mkdirSync(project);
    git(project, "init", "-q", "-b", "main");
    writeFileSync(join(project, "README.md"), "hi\n");
    git(project, "add", ".");
    git(project, "commit", "-q", "-m", "start");
    const workspace = (await core.call("POST", "/workspaces", { name: "P", folders: [project] }))
      .json;
    const role = (name: string) => ({ role: name, purpose: name, settings: claude });
    const department = (
      await core.call("POST", "/departments", {
        team: { name: "Web team", roles: [role("Writer"), role("Tester")] },
        workspaceId: workspace.id,
        autonomy: "trusted",
        lead: { settings: claude },
      })
    ).json;
    const task = (
      await core.call("POST", "/tasks/team", {
        goal: "Write the menu",
        team: { departmentId: department.id },
      })
    ).json;
    const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
    const named = (role: string) => agents.find((agent) => agent.role === role)?.name ?? "";
    await core.callTool(core.sessions[0], "delegate", { agent: named("Writer"), brief: "Write" });
    await core.callTool(core.sessions[0], "delegate", { agent: named("Tester"), brief: "Test" });

    const [writer, tester] = [1, 2].map((index) => {
      const id = core.sessions[index]?.id ?? "";
      return { id, path: core.store.getSession(id)?.options.workspacePath ?? "" };
    });
    expect(writer?.path.startsWith(join(directory, "data", "worktrees", task.taskId))).toBe(true);
    expect(JSON.stringify(core.sessions[1]?.sent[1])).toContain("on the branch office-town/");
    expect(git(project, "branch", "--list").split("\n")).toHaveLength(3);
    expect(readdirSync(project)).toEqual([".git", "README.md"]);

    // The writer commits on its branch, the lead merges it, and the writer is done.
    writeFileSync(join(writer?.path ?? "", "menu.md"), "bread\n");
    git(writer?.path ?? "", "add", ".");
    git(writer?.path ?? "", "commit", "-q", "-m", "menu");
    git(project, "merge", "-q", git(writer?.path ?? "", "rev-parse", "--abbrev-ref", "HEAD"));
    await core.registry.stop(writer?.id ?? "");
    await eventually(() => !existsSync(writer?.path ?? ""));
    expect(existsSync(writer?.path ?? "")).toBe(false);
    expect(existsSync(tester?.path ?? "")).toBe(true);

    await core.call("POST", `/tasks/${task.taskId}/stop`);
    expect((await core.call("DELETE", `/tasks/${task.taskId}`)).status).toBe(204);
    expect(existsSync(join(directory, "data", "worktrees", task.taskId))).toBe(false);
    expect(git(project, "branch", "--list").split("\n")).toHaveLength(3);
  });
});
