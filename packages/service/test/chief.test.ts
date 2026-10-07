import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DepartmentRecord, userRequestEventSchema } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSession } from "./support/fake-session.ts";
import { type Core, playTurn, settle, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

// A department made by hand, with a lead and no workers, in a folder of its own.
async function departmentIn(name: string) {
  const folder = join(directory, name);
  mkdirSync(folder);
  const workspace = (await core.call("POST", "/workspaces", { name, folders: [folder] })).json;
  const department = (
    await core.call("POST", "/departments", {
      team: { name, roles: [] },
      workspaceId: workspace.id,
      autonomy: "trusted",
      lead: { settings: claude },
    })
  ).json as DepartmentRecord;
  return { department, folder };
}

// The latest session of a task's lead, as the test plays it.
function leadOf(taskId: string | undefined): FakeSession | undefined {
  const task = core.store.getTask(taskId ?? "");
  const sessions = core.store.listSessions(taskId ?? "");
  const latest = sessions.findLast((session) => session.agentId === task?.leadAgentId);
  return core.sessions.find((session) => session.id === latest?.id);
}

function waitingPlan() {
  const request = core.store
    .listPendingRequests()
    .requests.find(({ event }) => event.type === "plan.requested");
  const event = userRequestEventSchema.parse(request?.event);
  if (event.type !== "plan.requested") throw new Error("expected a plan");
  return event;
}

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

  it("runs a plan: pieces in parallel, a downstream piece with the upstream result and folder, a queue for a busy department, a failure and an approved re-plan", async () => {
    const api = await departmentIn("api");
    const web = await departmentIn("web");
    const docsFolder = join(directory, "docs");
    mkdirSync(docsFolder);
    const docs = (await core.call("POST", "/workspaces", { name: "Docs", folders: [docsFolder] }))
      .json;
    await core.call("PUT", "/chief", { settings: claude });
    const goal = (await core.call("POST", "/tasks/chief", { goal: "Launch the bakery" })).json;
    const chief = leadOf(goal.task.id);
    const plan = (pieces: object[]) => core.callTool(chief, "propose_plan", { pieces });
    // The web team is busy with a goal of its own.
    const own = (
      await core.call("POST", "/tasks/team", {
        goal: "Fix the menu",
        team: { departmentId: web.department.id },
      })
    ).json;

    const unknown = await plan([{ key: "a", title: "A", department: "Nope", brief: "Do it" }]);
    expect(unknown).toMatchObject({ isError: true, text: expect.stringContaining("api, web") });
    const circle = await plan([
      { key: "a", title: "A", department: "api", brief: "Do it", waits_on: ["b"] },
      { key: "b", title: "B", department: "web", brief: "Do it", waits_on: ["a"] },
    ]);
    expect(circle).toMatchObject({ isError: true, text: expect.stringContaining("circle") });
    const docsPiece = {
      key: "docs",
      title: "Write the docs",
      department: "Docs team",
      brief: "Write the docs",
      new_department: { purpose: "Writes docs", harness: "claude", model: "haiku" },
    };
    const review = {
      key: "review",
      title: "Review the docs",
      department: "api",
      brief: "Review",
      waits_on: ["docs"],
    };
    const proposed = await plan([
      { key: "api", title: "Build the API", department: "api", brief: "Build the API" },
      docsPiece,
      { key: "web", title: "Build the site", department: "web", brief: "Build", waits_on: ["api"] },
      review,
    ]);
    expect(proposed.isError).toBe(false);
    playTurn(chief, "I proposed a plan.");
    expect(waitingPlan().payload.replan).toBe(false);
    // The user places the new department when approving.
    const approve = () => {
      const { requestId, pieces } = waitingPlan().payload;
      const place = { workspaceId: docs.id, autonomy: "trusted" };
      return core.call("POST", `/sessions/${goal.sessions[0].id}/commands`, {
        type: "answerPlan",
        requestId,
        answer: {
          outcome: "approved",
          pieces: pieces.map((each) =>
            "newDepartment" in each.department
              ? {
                  ...each,
                  department: { newDepartment: { ...each.department.newDepartment, ...place } },
                }
              : each,
          ),
        },
      });
    };
    expect((await approve()).status).toBe(204);
    await settle();

    const piece = (key: string) =>
      core.store.listPieces(goal.task.id).findLast((each) => each.key === key);
    const statuses = () =>
      core.store.listPieces(goal.task.id).map((each) => [each.key, each.status]);
    expect(statuses()).toEqual([
      ["api", "working"],
      ["docs", "working"],
      ["web", "waiting"],
      ["review", "waiting"],
    ]);
    const apiLead = leadOf(piece("api")?.pieceTaskId);
    expect(JSON.stringify(apiLead?.sent)).toContain("Launch the bakery");
    expect(JSON.stringify(leadOf(piece("docs")?.pieceTaskId)?.sent)).toContain("Docs team");

    playTurn(apiLead, "The API is at /api.");
    await settle();
    expect(chief?.sent.at(-1)).toMatchObject({
      text: `api finished "Build the API":\nThe API is at /api.`,
      origin: { kind: "piece", pieceId: piece("api")?.id, outcome: "done" },
    });
    expect(piece("web")?.status).toBe("queued");
    playTurn(leadOf(own.taskId), "The menu is fixed.");
    await settle();
    const webTask = piece("web")?.pieceTaskId;
    expect(piece("web")?.status).toBe("working");
    expect(JSON.stringify(leadOf(webTask)?.sent)).toContain("The API is at /api.");
    expect(core.store.listSessions(webTask ?? "")[0]?.options).toMatchObject({
      additionalPaths: [api.folder],
      readOnlyPaths: [api.folder],
    });
    await core.callTool(chief, "message_lead", { department: "web", message: "Keep it simple." });
    expect(leadOf(webTask)?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("Keep it simple."),
      origin: { kind: "message", from: goal.task.leadAgentId },
    });

    playTurn(leadOf(piece("docs")?.pieceTaskId), "I could not write the docs.", "failed");
    await settle();
    expect(chief?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("propose_plan"),
      origin: { kind: "piece", outcome: "failed" },
    });
    expect(piece("review")?.status).toBe("waiting");
    expect(core.store.getTask(goal.task.id)?.state).toBe("working");

    // The chief retries the docs; the review that waited on them is planned again.
    await plan([{ ...docsPiece, brief: "Write shorter docs" }, review]);
    expect(waitingPlan().payload.replan).toBe(true);
    await approve();
    await settle();
    expect(statuses()).toEqual([
      ["api", "done"],
      ["docs", "failed"],
      ["web", "working"],
      ["review", "dropped"],
      ["docs", "working"],
      ["review", "waiting"],
    ]);

    // A new department's piece is done only once its team was approved.
    const docsLead = leadOf(piece("docs")?.pieceTaskId);
    await core.callTool(docsLead, "propose_team", {
      name: "Docs team",
      roles: [{ role: "Writer", purpose: "Writes", harness: "claude", model: "haiku" }],
    });
    const proposal = core.store
      .listPendingRequests()
      .requests.find(({ event }) => event.type === "proposal.requested")?.event;
    const team = userRequestEventSchema.parse(proposal);
    if (team.type !== "proposal.requested") throw new Error("expected a proposal");
    await core.call("POST", `/sessions/${docsLead?.id}/commands`, {
      type: "answerProposal",
      requestId: team.payload.requestId,
      answer: { outcome: "approved", team: team.payload.team },
    });
    playTurn(leadOf(webTask), "The site is up.");
    playTurn(docsLead, "The docs are in docs/.");
    await settle();
    playTurn(leadOf(piece("review")?.pieceTaskId), "The docs read well.");
    await settle();
    expect(chief?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("No piece of the plan is left open"),
    });
    expect(core.store.getTask(goal.task.id)?.state).not.toBe("ended");
    playTurn(chief, "The bakery is launched.");
    await settle();
    expect(core.store.getTask(goal.task.id)?.state).toBe("ended");
  });

  it("keeps a goal whose chief stopped as idle while a piece is at work", async () => {
    await departmentIn("api");
    await core.call("PUT", "/chief", { settings: claude });
    const goal = (await core.call("POST", "/tasks/chief", { goal: "Build" })).json;
    const chief = leadOf(goal.task.id);
    await core.callTool(chief, "propose_plan", {
      pieces: [{ key: "api", title: "API", department: "api", brief: "Build the API" }],
    });
    playTurn(chief, "I proposed a plan.");
    const { requestId, pieces } = waitingPlan().payload;
    await core.call("POST", `/sessions/${chief?.id}/commands`, {
      type: "answerPlan",
      requestId,
      answer: { outcome: "approved", pieces },
    });
    await settle();
    await core.registry.stop(chief?.id ?? "", true);

    expect((await core.call("DELETE", `/tasks/${goal.task.id}`)).status).toBe(409);
  });
});
