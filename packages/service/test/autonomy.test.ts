import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lowerAutonomy } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allows } from "../src/autonomy/policy.ts";
import { type Core, startCore } from "./support/team-core.ts";

const workspace = join(tmpdir(), "bakery");
const notes = join(tmpdir(), "notes");
const request = (kind: string | undefined, locations?: string[]) => ({
  requestId: "r",
  title: "t",
  input: {},
  options: [{ optionId: "allow", label: "Allow", kind: "allow_once" as const }],
  ...(kind === undefined ? {} : { kind: kind as "edit" }),
  ...(locations === undefined ? {} : { locations }),
});

describe("autonomy policy", () => {
  it("lets each level through what it allows and asks for the rest", () => {
    const inside = request("edit", [join(workspace, "index.html")]);
    const second = request("read", [join(notes, "menu.md")]);
    const outside = request("edit", [join(tmpdir(), "elsewhere", "x")]);
    const command = request("execute");
    const unknown = request("edit");
    const folders = [workspace, notes];
    const verdicts = (level: "supervised" | "trusted" | "full") =>
      [inside, second, outside, command, unknown].map((each) => allows(level, each, folders));

    expect(verdicts("supervised")).toEqual([false, false, false, false, false]);
    expect(verdicts("trusted")).toEqual([true, true, false, false, false]);
    expect(verdicts("full")).toEqual([true, true, true, true, true]);
    expect(allows("trusted", request("edit", ["index.html"]), folders)).toBe(true);
    // Changing what makes git or a harness run commands asks; reading it does not.
    const settings = [join(".git", "config"), join(".Claude", "settings.json"), ".mcp.json"];
    expect(settings.map((path) => allows("trusted", request("edit", [path]), folders))).toEqual([
      false,
      false,
      false,
    ]);
    expect(allows("trusted", request("read", [join(".git", "config")]), folders)).toBe(true);
  });

  it("lets only reads through inside a read-only folder, however its path is written, unless it holds the agent's own", () => {
    const own = join(directory, "web");
    const upstream = join(directory, "api");
    mkdirSync(own);
    mkdirSync(upstream);
    const link = join(own, "api-link");
    symlinkSync(upstream, link, "junction");
    const at = (level: "trusted" | "full", kind: string | undefined, path: string) =>
      allows(level, request(kind, [path]), [own, upstream], [upstream]);

    expect(at("full", "edit", join(upstream, "new", "api.ts"))).toBe(false);
    expect(at("full", "edit", join(link, "api.ts"))).toBe(false);
    expect(at("full", "edit", join(upstream, "api.ts").toUpperCase())).toBe(
      process.platform !== "win32",
    );
    expect(at("full", "execute", upstream)).toBe(false);
    expect(at("full", undefined, join(upstream, "api.ts"))).toBe(false);
    expect(at("trusted", "read", join(link, "api.ts"))).toBe(true);
    expect(at("trusted", "edit", join(own, "index.html"))).toBe(true);
    // An upstream folder that holds the agent's own folder is no guard on its own work.
    expect(allows("trusted", request("edit", ["index.html"]), [own, directory], [directory])).toBe(
      true,
    );
  });

  it("lets a profile or an agent lower its level, never raise it", () => {
    expect(lowerAutonomy("full", "trusted")).toBe("trusted");
    expect(lowerAutonomy("trusted", "full")).toBe("trusted");
    expect(lowerAutonomy("bypass", undefined)).toBe("bypass");
  });
});

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-autonomy-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the guardrail", () => {
  it("answers what the level allows, records that it did, and leaves the rest to the user", async () => {
    const project = join(directory, "project");
    mkdirSync(project);
    const ws = (await core.call("POST", "/workspaces", { name: "P", folders: [project] })).json;
    const started = await core.call("POST", "/tasks", {
      prompt: "Edit the page",
      agent: { settings: { harness: "claude", environment: { kind: "native" } } },
      autonomy: "trusted",
      workspaceId: ws.id,
    });
    const agent = core.sessions[0];
    const ask = (requestId: string, kind: "edit" | "execute", path: string) =>
      agent?.emit({
        type: "permission.requested",
        payload: { ...request(kind, [path]), requestId },
      });

    ask("inside", "edit", join(project, "index.html"));
    ask("command", "execute", project);
    await new Promise((resolve) => setImmediate(resolve));

    expect(agent?.sent.at(-1)).toEqual({
      type: "answerPermission",
      requestId: "inside",
      optionId: "allow",
      answeredBy: { autonomy: "trusted" },
    });
    const waiting = core.store.listPendingRequests().requests;
    expect(waiting.map(({ event }) => event.payload.requestId)).toEqual(["command"]);

    await core.call("POST", `/sessions/${started.json.id}/commands`, {
      type: "answerPermission",
      requestId: "command",
      optionId: "allow",
    });
    expect(agent?.sent.at(-1)).toMatchObject({ requestId: "command", answeredBy: "user" });
  });

  it("resumes an agent in the mode its level has now, not the one it started in", async () => {
    const started = await core.call("POST", "/tasks", {
      prompt: "Tidy up",
      agent: { settings: { harness: "claude", environment: { kind: "native" } } },
      autonomy: "bypass",
      outputFolder: directory,
    });
    expect(started.json.options.permissionMode).toBe("bypass");
    await core.call("POST", `/sessions/${started.json.id}/stop`);
    const agent = core.store.getAgent(started.json.agentId);
    if (agent !== undefined) core.store.updateAgent(agent.id, { ...agent, autonomy: "supervised" });

    const resumed = await core.call("POST", `/sessions/${started.json.id}/resume`, {
      prompt: "Go on",
    });

    expect(resumed.json.options.permissionMode).toBe("ask");
  });
});
