import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Core, eventually, playTurn, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-drafts-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("drafts", () => {
  it("asks once more for a usable reply, then keeps only models and members that exist", async () => {
    const reply = core.call("POST", "/drafts/departments", {
      notes: ["A writer and a reviewer, led by Haiku"],
      drafter: claude,
    });
    await eventually(() => core.sessions.length === 1);
    const session = core.sessions[0];
    playTurn(session, "Here is your team!");
    expect(session?.sent.at(-1)).toMatchObject({ text: expect.stringContaining("JSON object") });

    const person = (role: string, more: object) => ({
      role,
      purpose: "",
      instructions: "",
      ...more,
    });
    const written = {
      questions: [],
      suggestions: ["Add a tester"],
      departments: [
        {
          name: "Words",
          lead: person("Lead", { harness: "claude", model: "haiku", model_from_user: true }),
          members: [
            person("Writer", { harness: "claude", model: "made-up", agent_id: "someone" }),
            person("Reviewer", { harness: "missing", model: "opencode-go/free-model" }),
          ],
        },
      ],
    };
    playTurn(session, `\`\`\`json\n${JSON.stringify(written)}\n\`\`\``);
    const { status, json } = await reply;

    expect(status).toBe(200);
    expect(json.suggestions).toEqual(["Add a tester"]);
    const [draft] = json.departments;
    expect(draft.lead).toMatchObject({ settings: { model: "haiku" }, modelGuessed: false });
    expect(draft.members[0]).toEqual({
      role: "Writer",
      purpose: "",
      instructions: "",
      settings: claude,
      modelGuessed: true,
    });
    expect(draft.members[1].settings).toEqual(claude);
    expect(session?.sent.at(-1)).toEqual({ type: "stop" });
  });
});
