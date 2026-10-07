import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Core, playTurn, settle, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-chief-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the chief", () => {
  it("runs one goal at a time and starts the next queued one when the first ends", async () => {
    expect((await core.call("POST", "/tasks/chief", { goal: "Launch" })).status).toBe(409);
    const chief = (await core.call("PUT", "/chief", { settings: claude })).json;
    expect(chief).toMatchObject({ name: "@chief", role: "Chief", autonomy: "trusted" });
    expect((await core.call("GET", "/chief")).json.id).toBe(chief.id);

    const first = (await core.call("POST", "/tasks/chief", { goal: "Launch the bakery" })).json;
    const second = (await core.call("POST", "/tasks/chief", { goal: "Open a second shop" })).json;
    expect(first.task.state).toBe("working");
    expect(second).toEqual({ task: expect.objectContaining({ state: "queued" }), sessions: [] });
    const [session] = core.sessions;
    expect(session?.extras.toolServers).toHaveLength(1);
    // The chief leads its task but has no team to hand work to.
    const tools = await core.callTool(session, "team_status", {});
    expect(tools).toMatchObject({ isError: true, text: 'Unknown tool "team_status".' });

    playTurn(session, "Nothing to plan.");
    await settle();
    expect(core.store.getTask(first.task.id)?.state).toBe("ended");
    expect(core.store.getTask(second.task.id)?.state).toBe("working");
    expect(core.sessions[1]?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("Open a second shop"),
    });
  });
});
