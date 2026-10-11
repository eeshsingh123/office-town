import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentRecord, LibraryItem, SessionCommand } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Core, settle, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-library-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

const everyone = { everyone: true, departmentIds: [], agentIds: [] };

describe("library", () => {
  it("gives each agent only the items given to it, counts opens from its reads, lets an agent add freely and change only after the user approves", async () => {
    const project = join(directory, "bakery");
    mkdirSync(project);
    const workspace = (
      await core.call("POST", "/workspaces", {
        name: "Bakery",
        kind: "folders",
        folders: [{ path: project, access: "edit" }],
      })
    ).json;
    const department = (
      await core.call("POST", "/departments", {
        team: {
          name: "Web team",
          roles: [{ role: "Tester", purpose: "Tests", settings: claude }],
        },
        workspaceId: workspace.id,
        // The fullest level, so nothing but the user can approve a Library change.
        autonomy: "full",
        lead: { settings: claude },
      })
    ).json;
    const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
    const tester = agents.find((agent) => agent.role === "Tester");
    const add = async (name: string, givenTo: object) => {
      const file = core.store.saveFile({ kind: "file", name, content: Buffer.from(name) });
      const added = await core.call("POST", `/workspaces/${workspace.id}/library`, {
        attachmentId: file.id,
        givenTo,
      });
      return added.json as LibraryItem;
    };
    const voice = await add("voice.md", {
      ...everyone,
      everyone: false,
      departmentIds: [department.id],
    });
    const handbook = await add("handbook.md", everyone);
    await add("secret.md", { ...everyone, everyone: false, agentIds: [tester?.id] });

    await core.call("POST", "/tasks/team", { goal: "Bake", team: { departmentId: department.id } });
    const lead = core.sessions[0];
    const prompt = lead?.sent.find((command) => command.type === "prompt") as Extract<
      SessionCommand,
      { type: "prompt" }
    >;
    expect(prompt.attachments?.map((file) => [file.name, file.reference])).toEqual([
      ["voice.md", true],
      ["handbook.md", true],
    ]);
    const leadSession = core.store.getSession(lead?.id ?? "");
    expect(leadSession?.options.readOnlyPaths).toContain(dirname(voice.file.path));

    lead?.emit({
      type: "action.started",
      payload: { actionId: "a1", kind: "read", title: "Read", locations: [voice.file.path] },
    });
    const counts = (await core.call("GET", "/library")).json as LibraryItem[];
    const countOf = (id: string) => counts.find((item) => item.id === id);
    expect(countOf(voice.id)).toMatchObject({ givenIn: 1, openedIn: 1 });
    expect(countOf(handbook.id)).toMatchObject({ givenIn: 1, openedIn: 0 });

    writeFileSync(join(project, "notes.md"), "notes");
    expect((await core.callTool(lead, "add_to_library", { path: "notes.md" })).isError).toBe(false);
    expect(core.store.libraryOfWorkspace(workspace.id).at(-1)).toMatchObject({
      file: { name: "notes.md" },
      addedByAgentId: leadSession?.agentId,
      givenTo: { departmentIds: [department.id] },
    });
    const outside = await core.callTool(lead, "add_to_library", { path: join(directory, "data") });
    expect(outside.isError).toBe(true);

    await core.callTool(lead, "change_library", {
      item: "voice.md",
      change: "remove",
      reason: "It is out of date",
    });
    await settle();
    const [asked] = core.store.listPendingRequests().requests;
    expect(core.store.getLibraryItem(voice.id)).toBeDefined();
    expect(asked?.event.type).toBe("permission.requested");
    await core.call("POST", `/sessions/${lead?.id}/commands`, {
      type: "answerPermission",
      requestId: asked?.event.type === "permission.requested" ? asked.event.payload.requestId : "",
      optionId: "approve",
    });
    expect(core.store.getLibraryItem(voice.id)).toBeUndefined();
    // The task was sent it, so its copy stays with the task.
    expect(existsSync(voice.file.path)).toBe(true);
  });
});
