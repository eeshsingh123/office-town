import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
