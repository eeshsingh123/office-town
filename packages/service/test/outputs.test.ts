import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskOutputs } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSession } from "./support/fake-session.ts";
import { type Core, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let project: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-outputs-"));
  project = join(directory, "bakery");
  mkdirSync(join(project, "site"), { recursive: true });
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

// A lead working in the bakery folder, and its task.
async function startLead(): Promise<{ lead: FakeSession; taskId: string }> {
  const workspace = (
    await core.call("POST", "/workspaces", {
      name: "Bakery",
      kind: "folders",
      folders: [{ path: project, access: "edit" }],
    })
  ).json;
  const department = (
    await core.call("POST", "/departments", {
      team: { name: "Web team", roles: [{ role: "Designer", purpose: "Pages", settings: claude }] },
      workspaceIds: [workspace.id],
      autonomy: "full",
      lead: { settings: claude },
    })
  ).json;
  await core.call("POST", "/tasks/team", { goal: "Bake", team: { departmentId: department.id } });
  const lead = core.sessions[0];
  const session = core.store.getSession(lead?.id ?? "");
  if (lead === undefined || session === undefined) throw new Error("The lead did not start.");
  return { lead, taskId: session.taskId };
}

async function listening(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}/`;
}

describe("outputs", () => {
  it("keeps each version a result is shown in and serves a page only from its task's folder", async () => {
    const { lead, taskId } = await startLead();
    const page = join(project, "site", "index.html");
    writeFileSync(page, '<link rel="stylesheet" href="style.css">first');
    writeFileSync(join(project, "site", "style.css"), "body {}");
    writeFileSync(join(project, "site", ".env"), "SECRET=1");

    const show = { title: "Home page", path: "site/index.html" };
    expect((await core.callTool(lead, "show_result", show)).text).toBe(
      'Shown to the user as "Home page".',
    );
    writeFileSync(page, "second");
    expect((await core.callTool(lead, "show_result", show)).text).toContain("version 2");
    const outside = join(directory, "outside.html");
    writeFileSync(outside, "no");
    expect((await core.callTool(lead, "show_result", { title: "No", path: outside })).isError).toBe(
      true,
    );

    const { results } = (await core.call("GET", `/tasks/${taskId}/outputs`)).json as TaskOutputs;
    expect(results).toHaveLength(1);
    expect(results[0]?.versions.map(({ number, kept }) => [number, kept])).toEqual([
      [1, true],
      [2, true],
    ]);
    const first = await core.call("POST", `/tasks/${taskId}/preview`, {
      outputId: results[0]?.id,
      version: 1,
    });
    const url = first.json.url as string;
    expect(await (await fetch(url)).text()).toContain("first");
    // The page's own files load beside it; hidden ones and anything above its folder never do.
    expect((await fetch(url.replace("index.html", "style.css"))).status).toBe(200);
    expect((await fetch(url.replace("index.html", ".env"))).status).toBe(404);
    expect((await fetch(url.replace("site/index.html", "..%2Foutside.html"))).status).toBe(404);
    const refused = await core.call("POST", `/tasks/${taskId}/preview`, { path: outside });
    expect(refused.status).toBe(404);
  });

  it("lists the files agents changed and the local sites they named that still answer", async () => {
    const { lead, taskId } = await startLead();
    const site = createServer((_request, response) => response.end("ok"));
    const answering = await listening(site);
    const gone = createServer();
    const stopped = await listening(gone);
    await new Promise((resolve) => gone.close(resolve));
    try {
      const edited = join(project, "site", "app.ts");
      writeFileSync(edited, "code");
      lead.emit({
        type: "action.started",
        payload: { actionId: "e1", kind: "edit", title: "Edit", input: {}, locations: [edited] },
      });
      lead.emit({
        type: "action.ended",
        payload: { actionId: "e1", outcome: "completed", result: "" },
      });
      lead.emit({
        type: "action.started",
        payload: { actionId: "x1", kind: "execute", title: "Run", input: { command: "pnpm dev" } },
      });
      lead.emit({
        type: "action.updated",
        payload: { actionId: "x1", output: `\u001b[32mLocal:\u001b[0m ${answering}\n${stopped}` },
      });

      const outputs = (await core.call("GET", `/tasks/${taskId}/outputs`)).json as TaskOutputs;
      expect(outputs.changed.map(({ path, deleted }) => [path, deleted])).toEqual([
        [edited, false],
      ]);
      expect(outputs.spotted.map(({ url }) => url)).toEqual([answering]);

      // Shown by its IP address it is the same site, so it is no longer only spotted.
      const url = answering.replace("localhost", "127.0.0.1");
      await core.callTool(lead, "show_result", { title: "Shop", url });
      const shown = (await core.call("GET", `/tasks/${taskId}/outputs`)).json as TaskOutputs;
      expect(shown.results.map(({ target }) => target)).toEqual([{ kind: "site", url: answering }]);
      expect(shown.running).toEqual([answering]);
      expect(shown.spotted).toEqual([]);
    } finally {
      await new Promise((resolve) => site.close(resolve));
    }
  });
  it("opens a worker's result from the lead's folder once its worktree is merged and removed", async () => {
    const { lead, taskId } = await startLead();
    const options = core.store.getSession(lead.id)?.options;
    if (options === undefined) throw new Error("The lead has no session.");
    const worktree = join(directory, "data", "worktrees", taskId, "designer");
    const worker = core.store.createAgent({
      name: "@designer",
      colour: "#2F7565",
      settings: { harness: "claude", environment: { kind: "native" } },
    });
    core.store.createSession({
      id: "worker-session",
      taskId,
      agentId: worker.id,
      options: { ...options, workspacePath: worktree },
    });
    const shownAt = join(worktree, "site", "index.html");
    const result = core.store.showOutput({
      taskId,
      agentId: worker.id,
      sessionId: "worker-session",
      title: "Page",
      target: { kind: "file", path: shownAt },
      kept: false,
    });
    const merged = join(project, "site", "index.html");
    writeFileSync(merged, "merged");

    const outputs = (await core.call("GET", `/tasks/${taskId}/outputs`)).json as TaskOutputs;
    expect(outputs.movedTo).toEqual({ [result.id]: merged });
    expect(outputs.freshOnly).toEqual([worker.id]);
    const preview = await core.call("POST", `/tasks/${taskId}/preview`, {
      outputId: result.id,
      version: 1,
    });
    expect(await (await fetch(preview.json.url as string)).text()).toBe("merged");
  });
});
