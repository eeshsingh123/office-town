import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRecord,
  type DepartmentRecord,
  type Team,
  userRequestEventSchema,
} from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSession } from "./support/fake-session.ts";
import { type Core, startCore } from "./support/team-core.ts";

const native = { kind: "native" } as const;

let directory: string;
let core: Core;

const call = (method: string, path: string, body?: unknown) => core.call(method, path, body);
const propose = (session: FakeSession, input: object) =>
  core.callTool(session, "propose_team", input);

function waitingProposal() {
  const event = userRequestEventSchema.parse(core.store.listPendingRequests().requests[0]?.event);
  if (event.type !== "proposal.requested") throw new Error("expected a proposal");
  return event;
}

function answer(sessionId: string, requestId: string, decision: object) {
  return call("POST", `/sessions/${sessionId}/commands`, {
    type: "answerProposal",
    requestId,
    answer: decision,
  });
}

const workersOf = async (department: DepartmentRecord) =>
  ((await call("GET", "/agents")).json as AgentRecord[])
    .filter((agent) => agent.departmentId === department.id && agent.id !== department.leadAgentId)
    .map((agent) => [agent.name, agent.role]);

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-team-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("teams", () => {
  it("lets a new lead propose its team, which the user edits and approves into a department", async () => {
    const project = join(directory, "bakery");
    mkdirSync(project);
    const workspace = (await call("POST", "/workspaces", { name: "Bakery", folders: [project] }))
      .json;
    const started = await call("POST", "/tasks/team", {
      goal: "Build a bakery site",
      team: {
        lead: { settings: { harness: "claude", environment: native } },
        workspaceId: workspace.id,
        autonomy: "trusted",
      },
    });
    expect(started.status).toBe(201);
    const [lead] = core.sessions;
    if (lead === undefined) throw new Error("expected the lead to start");
    expect(lead.sent[1]).toMatchObject({ origin: { kind: "brief" } });
    expect(JSON.stringify(lead.sent[1])).toContain("opencode-go/free-model (free)");
    // A harness reads its tools once, so the lead has delegate from the start; it waits for approval.
    const early = await core.callTool(lead, "delegate", { agent: "@anyone", brief: "Go" });
    expect(early).toMatchObject({
      isError: true,
      text: expect.stringContaining("not approved yet"),
    });

    const wrong = await propose(lead, {
      name: "Web team",
      roles: [{ role: "Writer", purpose: "Writes", harness: "claude", model: "opus-9" }],
    });
    expect(wrong).toMatchObject({ isError: true, text: expect.stringContaining("haiku") });
    const roles = [
      {
        role: "Frontend developer",
        purpose: "Builds the page",
        harness: "opencode",
        model: "opencode-go/free-model",
      },
      { role: "Copywriter", purpose: "Writes the menu", harness: "claude", model: "haiku" },
    ];
    expect((await propose(lead, { name: "Web team", roles })).isError).toBe(false);
    const proposal = waitingProposal();
    expect(proposal.payload.place).toEqual({
      workspaceName: "Bakery",
      folders: [project],
      autonomy: "trusted",
    });

    // The user renames a role before approving.
    const team: Team = proposal.payload.team;
    const [frontend, writer] = team.roles;
    if (frontend === undefined || writer === undefined) throw new Error("expected two roles");
    const edited = { ...team, roles: [frontend, { ...writer, role: "Writer" }] };
    const { requestId } = proposal.payload;
    expect(
      (await answer(started.json.id, requestId, { outcome: "approved", team: edited })).status,
    ).toBe(204);
    const [department] = (await call("GET", "/departments")).json as DepartmentRecord[];
    if (department === undefined) throw new Error("expected the department");
    expect(department).toMatchObject({
      name: "Web team",
      autonomy: "trusted",
      branchPerWorker: true,
    });
    expect((await workersOf(department)).map(([, role]) => role)).toEqual([
      "Frontend developer",
      "Writer",
    ]);
    expect((await call("GET", `/tasks/${started.json.taskId}`)).json.task.departmentId).toBe(
      department.id,
    );
    expect(lead.sent.at(-1)).toMatchObject({
      origin: { kind: "notice", summary: "You approved the team: Frontend developer, Writer" },
    });

    // One goal at a time: the department is at work.
    const second = await call("POST", "/tasks/team", {
      goal: "Another",
      team: { departmentId: department.id },
    });
    expect(second.status).toBe(409);

    // Keeps the writer, drops the frontend developer, adds a tester; declined first, then approved.
    const [, writerName] = (await workersOf(department)).map(([name]) => name);
    const change = {
      name: "Web team",
      roles: [
        { role: "Writer", purpose: "Writes the menu", harness: "claude", keep: writerName },
        { role: "Tester", purpose: "Checks the page", harness: "claude" },
      ],
    };
    await propose(lead, change);
    await answer(started.json.id, waitingProposal().payload.requestId, { outcome: "declined" });
    expect((await workersOf(department)).length).toBe(2);
    await propose(lead, change);
    const changed = waitingProposal();
    expect(changed.payload.departmentId).toBe(department.id);
    await answer(started.json.id, changed.payload.requestId, {
      outcome: "approved",
      team: changed.payload.team,
    });
    expect(await workersOf(department)).toEqual([
      [writerName, "Writer"],
      [expect.any(String), "Tester"],
    ]);

    // A change made by hand reaches the lead at work.
    const byHand = {
      name: "Web team",
      roles: [
        {
          role: "Designer",
          purpose: "Draws",
          settings: { harness: "claude", environment: native },
        },
      ],
    };
    expect((await call("PUT", `/departments/${department.id}/team`, byHand)).status).toBe(200);
    expect(lead.sent.at(-1)).toMatchObject({
      origin: { kind: "notice", summary: expect.stringContaining("joined as Designer") },
    });

    // Saving the team as it is keeps a member's own instructions and does not wake the lead.
    const designer = core.store.listMembers(department.id).find((one) => one.role === "Designer");
    if (designer === undefined) throw new Error("expected the designer");
    const settings = { ...designer.settings, instructions: "Use the brand colours" };
    core.store.updateAgent(designer.id, { ...designer, settings });
    const told = lead.sent.length;
    const same = { ...byHand, roles: [{ ...byHand.roles[0], agentId: designer.id }] };
    expect((await call("PUT", `/departments/${department.id}/team`, same)).status).toBe(200);
    expect(core.store.getAgent(designer.id)?.settings.instructions).toBe("Use the brand colours");
    expect(lead.sent).toHaveLength(told);
  });

  it("leaves no task behind when its first agent cannot start, so the department stays free", async () => {
    const project = join(directory, "bakery");
    mkdirSync(project);
    const workspace = (await call("POST", "/workspaces", { name: "Bakery", folders: [project] }))
      .json;
    const department = (
      await call("POST", "/departments", {
        team: { name: "Web team", roles: [] },
        workspaceId: workspace.id,
        autonomy: "trusted",
        lead: { settings: { harness: "missing", environment: native } },
      })
    ).json as DepartmentRecord;

    const started = await call("POST", "/tasks/team", {
      goal: "Build a bakery site",
      team: { departmentId: department.id },
    });
    expect(started.status).toBe(400);
    expect((await call("GET", "/tasks")).json.tasks).toEqual([]);
    expect(core.store.activeTaskOf(department.id)).toBeUndefined();
  });
});
