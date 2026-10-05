import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionActivity } from "../src/registry/activity.ts";
import { stopIdleAgents } from "../src/registry/idle-stop.ts";
import { type Core, playTurn, settle, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

// A department made by hand, with a writer and a tester, starting on a goal.
async function teamAtWork(goal = "Build a bakery site") {
  const project = join(directory, "bakery");
  mkdirSync(project, { recursive: true });
  const workspace = (await core.call("POST", "/workspaces", { name: "Bakery", folders: [project] }))
    .json;
  const role = (name: string) => ({ role: name, purpose: `${name}s`, settings: claude });
  const department = (
    await core.call("POST", "/departments", {
      team: { name: "Web team", roles: [role("Writer"), role("Tester")] },
      workspaceId: workspace.id,
      autonomy: "trusted",
      lead: { settings: claude },
    })
  ).json;
  const task = (
    await core.call("POST", "/tasks/team", { goal, team: { departmentId: department.id } })
  ).json;
  const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
  const named = (role: string) => agents.find((agent) => agent.role === role)?.name ?? "";
  return { department, task, writer: named("Writer"), tester: named("Tester") };
}

const lastSent = (index: number) => core.sessions[index]?.sent.at(-1);

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-delegation-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("delegation", () => {
  it("starts workers on their pieces at once and hands each result to the lead, resuming it if it was left idle", async () => {
    const { writer, tester } = await teamAtWork();
    const lead = core.sessions[0];
    const leadAgentId = core.store.getSession(lead?.id ?? "")?.agentId;

    expect(
      (await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" })).text,
    ).toContain(`Delegated to ${writer}`);
    await core.callTool(lead, "delegate", { agent: tester, brief: "Test the page" });
    expect(core.sessions).toHaveLength(3);
    expect(lastSent(1)).toMatchObject({
      text: expect.stringContaining("Write the menu"),
      origin: { kind: "brief", from: leadAgentId },
    });
    expect(JSON.stringify(lastSent(1))).toContain("Build a bakery site");
    const busy = await core.callTool(lead, "delegate", { agent: writer, brief: "And more" });
    expect(busy).toMatchObject({ isError: true, text: expect.stringContaining("still working") });
    const stranger = await core.callTool(lead, "delegate", { agent: "@nobody", brief: "Help" });
    expect(stranger).toMatchObject({ isError: true, text: expect.stringContaining(writer) });
    // Workers cannot hire.
    expect(
      (await core.callTool(core.sessions[1], "delegate", { agent: tester, brief: "x" })).isError,
    ).toBe(true);

    // The tester asks the user first, so its turn ends without a result.
    await core.callTool(core.sessions[2], "ask_user", { question: "Which browser?" });
    playTurn(core.sessions[2], "I asked which browser to test in.");
    playTurn(core.sessions[1], "The menu is in menu.md.");
    await settle();
    expect(lastSent(0)).toEqual({
      type: "prompt",
      text: `${writer} finished:\nThe menu is in menu.md.`,
      origin: {
        kind: "result",
        delegationId: expect.any(String),
        agentId: expect.any(String),
        outcome: "done",
      },
    });
    const status = await core.callTool(lead, "team_status", {});
    expect(status.text).toContain(`${tester}, Tester (claude): is waiting for the user`);

    // The lead is left idle and stopped; the tester's result resumes it.
    await core.registry.stop(lead?.id ?? "", true);
    const [question] = core.store.listPendingRequests().requests;
    await core.call("POST", `/sessions/${core.sessions[2]?.id}/commands`, {
      type: "answerQuestion",
      requestId: question?.event.payload.requestId,
      answers: [{ questionId: "1", selected: ["Chrome"] }],
    });
    playTurn(core.sessions[2], "The page works in Chrome.");
    await settle();
    const resumed = core.sessions.at(-1);
    expect(core.store.getSession(resumed?.id ?? "")?.resumedFrom).toBe(lead?.id);
    expect(resumed?.sent.at(-1)).toMatchObject({
      text: `${tester} finished:\nThe page works in Chrome.`,
    });
  });

  it("stops a whole team without waking its lead, and after a restart continues it with the work that was cut off", async () => {
    const first = await teamAtWork("First goal");
    await core.callTool(core.sessions[0], "delegate", { agent: first.writer, brief: "Write" });
    expect((await core.call("POST", `/tasks/${first.task.taskId}/stop`)).status).toBe(204);
    await settle();
    expect(core.sessions.every((session) => session.sent.at(-1)?.type === "stop")).toBe(true);
    expect(core.store.listDelegations(first.task.taskId).map((one) => one.status)).toEqual([
      "stopped",
    ]);

    const second = (
      await core.call("POST", "/tasks/team", {
        goal: "Second goal",
        team: { departmentId: first.department.id },
      })
    ).json;
    await core.callTool(core.sessions.at(-1), "delegate", {
      agent: first.writer,
      brief: "Write the second menu",
    });
    // A restart: the core stops, and a new one opens the same data folder.
    await core.close();
    core = await startCore(join(directory, "data"));
    expect(core.store.listDelegations(second.taskId).map((one) => one.status)).toEqual([
      "interrupted",
    ]);

    const continued = await core.call("POST", `/tasks/${second.taskId}/continue`, {});
    expect(continued.status).toBe(201);
    expect(core.sessions[0]?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining(`- ${first.writer}: Write the second menu`),
      origin: { kind: "notice" },
    });
    expect(core.store.listDelegations(second.taskId).map((one) => one.status)).toEqual(["stopped"]);
  });

  it("calls in a guest on a copy without instruction files, hands its answer to the lead, and lets it leave", async () => {
    await teamAtWork();
    const lead = core.sessions[0];
    const project = join(directory, "bakery");
    writeFileSync(join(project, "menu.md"), "Bread");
    writeFileSync(join(project, "CLAUDE.md"), "Be brief");
    mkdirSync(join(project, ".claude"));

    const outside = await core.callTool(lead, "outsource", { brief: "Check", paths: [".."] });
    expect(outside).toMatchObject({ isError: true, text: expect.stringContaining("workspace") });
    await core.callTool(lead, "outsource", { brief: "Check the menu", paths: ["."] });
    const guest = core.store.getSession(core.sessions[1]?.id ?? "");
    const copy = guest?.options.workspacePath ?? "";
    expect(guest?.options.isolated).toBe(true);
    expect(core.store.getAgent(guest?.agentId ?? "")).toMatchObject({ guest: true });
    expect(core.store.getAgent(guest?.agentId ?? "")?.departmentId).toBeUndefined();
    expect(existsSync(join(copy, "menu.md"))).toBe(true);
    expect(existsSync(join(copy, "CLAUDE.md")) || existsSync(join(copy, ".claude"))).toBe(false);

    playTurn(core.sessions[1], "The menu has no prices.");
    await settle();
    expect(lastSent(0)).toMatchObject({
      text: expect.stringContaining("The menu has no prices."),
      origin: { kind: "result" },
    });
    expect(core.store.getSession(guest?.id ?? "")?.status).toBe("exited");
  });

  it("stops an agent left idle, but not one waiting for the user", async () => {
    const activity = new SessionActivity(core.registry);
    const { task } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", {
      agent: (await teamMembers())[0] ?? "",
      brief: "Write",
    });
    const worker = core.sessions[1];
    playTurn(lead, "Handed out the work.");
    await core.callTool(worker, "ask_user", { question: "Formal or casual?" });
    playTurn(worker, "Waiting for the user.");

    const stop = stopIdleAgents(core.registry, core.store, activity, 1);
    await settle();
    stop();

    const sessions = core.store.listSessions(task.taskId);
    expect(sessions.map((session) => session.status)).toEqual(["exited", "running"]);
  });
});

async function teamMembers(): Promise<string[]> {
  const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
  return agents.filter((agent) => agent.role === "Writer").map((agent) => agent.name);
}
