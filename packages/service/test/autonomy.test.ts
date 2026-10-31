import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lowerAutonomy } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allows } from "../src/autonomy/policy.ts";
import { type Core, startCore } from "./support/team-core.ts";

const request = (kind: string | undefined, locations?: string[]) => ({
  requestId: "r",
  title: "t",
  input: {},
  options: [{ optionId: "allow", label: "Allow", kind: "allow_once" as const }],
  ...(kind === undefined ? {} : { kind: kind as "edit" }),
  ...(locations === undefined ? {} : { locations }),
});

describe("autonomy policy", () => {
  it("lets only reads through inside a read-only folder, however its path is written, unless it holds the agent's own", () => {
    const own = join(directory, "web");
    const upstream = join(directory, "api");
    mkdirSync(own);
    mkdirSync(upstream);
    const link = join(own, "api-link");
    symlinkSync(upstream, link, "junction");
    const at = (level: "full", kind: string | undefined, path: string) =>
      allows(level, request(kind, [path]), [own, upstream], [upstream]);

    expect(at("full", "edit", join(upstream, "new", "api.ts"))).toBe(false);
    expect(at("full", "edit", join(link, "api.ts"))).toBe(false);
    expect(at("full", "edit", join(upstream, "api.ts").toUpperCase())).toBe(
      process.platform !== "win32",
    );
    expect(at("full", "execute", upstream)).toBe(false);
    expect(at("full", undefined, join(upstream, "api.ts"))).toBe(false);
    expect(at("full", "read", join(link, "api.ts"))).toBe(true);
    expect(at("full", "edit", join(own, "index.html"))).toBe(true);
    // An upstream folder that holds the agent's own folder is no guard on its own work.
    expect(allows("full", request("edit", ["index.html"]), [own, directory], [directory])).toBe(
      true,
    );
  });

  it("lets a profile or an agent lower its level, never raise it", () => {
    expect(lowerAutonomy("full", "supervised")).toBe("supervised");
    expect(lowerAutonomy("supervised", "full")).toBe("supervised");
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
    const upstream = join(directory, "upstream");
    mkdirSync(project);
    mkdirSync(upstream);
    const ws = (
      await core.call("POST", "/workspaces", {
        name: "P",
        kind: "folders",
        folders: [
          { path: project, access: "edit" },
          { path: upstream, access: "read" },
        ],
      })
    ).json;
    const started = await core.call("POST", "/tasks", {
      prompt: "Edit the page",
      agent: { settings: { harness: "claude", environment: { kind: "native" } } },
      autonomy: "full",
      workspaceId: ws.id,
    });
    const agent = core.sessions[0];
    const ask = (requestId: string, kind: "edit", path: string) =>
      agent?.emit({
        type: "permission.requested",
        payload: { ...request(kind, [path]), requestId },
      });

    ask("inside", "edit", join(project, "index.html"));
    ask("command", "edit", join(upstream, "api.ts"));
    await new Promise((resolve) => setImmediate(resolve));

    expect(agent?.sent.at(-1)).toEqual({
      type: "answerPermission",
      requestId: "inside",
      optionId: "allow",
      answeredBy: { autonomy: "full" },
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
