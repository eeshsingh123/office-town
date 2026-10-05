import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
});
