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

  it("hands an idle lead every result that comes at once, in order", async () => {
    const { writer, tester } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    await core.callTool(lead, "delegate", { agent: tester, brief: "Test the page" });
    await core.registry.stop(lead?.id ?? "", true);

    // The second result comes while the lead resumed for the first is still starting.
    playTurn(core.sessions[1], "Menu done.");
    playTurn(core.sessions[2], "Tests pass.");
    await settle();

    const prompts = core.sessions.at(-1)?.sent.filter((command) => command.type === "prompt");
    expect(prompts?.map((prompt) => prompt.text)).toEqual([
      `${writer} finished:
Menu done.`,
      `${tester} finished:
Tests pass.`,
    ]);
  });

  it("tells the lead at once when a worker cannot start, and keeps no work out with it", async () => {
    const { department, task, writer } = await teamAtWork();
    const [member] = (await core.call("GET", "/agents")).json.filter(
      (agent: AgentRecord) => agent.name === writer,
    );
    await core.call("PUT", `/departments/${department.id}/team`, {
      name: "Web team",
      roles: [
        {
          role: "Writer",
          purpose: "Writes",
          agentId: member.id,
          settings: { ...claude, model: "broken" },
        },
      ],
    });

    const reply = await core.callTool(core.sessions[0], "delegate", {
      agent: writer,
      brief: "Write",
    });

    expect(reply).toMatchObject({
      isError: true,
      text: expect.stringContaining("could not start"),
    });
    expect(core.store.listDelegations(task.taskId)).toEqual([]);
  });

  it("keeps a goal's state: working, waiting on the user, working while its lead owes a turn for a result, ended once the lead finished, and idle when cut off", async () => {
    const first = await teamAtWork("First goal");
    const state = (taskId: string) => core.store.getTask(taskId)?.state;
    const [lead] = core.sessions;
    expect(state(first.task.taskId)).toBe("working");

    lead?.emit({ type: "turn.started", payload: { turnId: "1" } });
    await core.callTool(lead, "delegate", { agent: first.writer, brief: "Write" });
    lead?.emit({ type: "turn.ended", payload: { turnId: "1", outcome: "completed" } });
    const writer = core.sessions[1];
    expect(state(first.task.taskId)).toBe("working");
    await core.callTool(writer, "ask_user", { question: "Which menu?" });
    expect(state(first.task.taskId)).toBe("waiting");
    const [question] = core.store.listPendingRequests().requests;
    await core.call("POST", `/sessions/${writer?.id}/commands`, {
      type: "answerQuestion",
      requestId: question?.event.payload.requestId,
      answers: [{ questionId: "1", selected: ["Lunch"] }],
    });
    // The writer's result reaches the lead after the lead's turn ended: its next turn is due.
    await settle();
    playTurn(writer, "The menu is in menu.md.");
    await settle();
    expect(state(first.task.taskId)).toBe("working");
    playTurn(lead, "The site is done.");
    expect(state(first.task.taskId)).toBe("ended");

    // A new goal stops the agents the ended one left open; a restart cuts the new one off.
    const second = (
      await core.call("POST", "/tasks/team", {
        goal: "Second goal",
        team: { departmentId: first.department.id },
      })
    ).json;
    expect(
      [lead, writer].map((session) => core.store.getSession(session?.id ?? "")?.status),
    ).toEqual(["exited", "exited"]);
    expect(state(first.task.taskId)).toBe("ended");
    expect(state(second.taskId)).toBe("working");
    await core.close();
    core = await startCore(join(directory, "data"));
    expect(state(second.taskId)).toBe("idle");
  });

  it("ends a goal only once its lead acted on every answer and result, not on one given inside its turn, and ends a stopped one whose lead was idle", async () => {
    const { task, writer } = await teamAtWork();
    const [lead] = core.sessions;
    const states: string[] = [];
    core.store.subscribe((change) => {
      if (change.type === "task" && change.task.id === task.taskId) states.push(change.task.state);
    });
    const state = () => core.store.getTask(task.taskId)?.state;

    // An answer is stored before the lead is told it: the goal goes from waiting to working.
    lead?.emit({ type: "turn.started", payload: { turnId: "1" } });
    await core.callTool(lead, "ask_user", { question: "Which menu?" });
    lead?.emit({ type: "turn.ended", payload: { turnId: "1", outcome: "completed" } });
    const [question] = core.store.listPendingRequests().requests;
    await core.call("POST", `/sessions/${lead?.id}/commands`, {
      type: "answerQuestion",
      requestId: question?.event.payload.requestId,
      answers: [{ questionId: "1", selected: ["Lunch"] }],
    });
    expect(states.slice(-2)).toEqual(["waiting", "working"]);

    // A result told mid-turn is still owed a turn once that turn ends.
    lead?.emit({ type: "turn.started", payload: { turnId: "2" } });
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write" });
    playTurn(core.sessions[1], "The menu is in menu.md.");
    await settle();
    lead?.emit({ type: "turn.ended", payload: { turnId: "2", outcome: "completed" } });
    expect(state()).toBe("working");
    playTurn(lead, "The menu is done.");
    expect(state()).toBe("ended");

    // The harness's own question is answered inside the turn, so no turn is owed after it.
    lead?.emit({ type: "turn.started", payload: { turnId: "3" } });
    const asked = { questionId: "1", text: "Which?", options: [], multiSelect: false };
    lead?.emit({ type: "question.requested", payload: { requestId: "q", questions: [asked] } });
    lead?.emit({ type: "question.resolved", payload: { requestId: "q", outcome: "answered" } });
    lead?.emit({ type: "turn.ended", payload: { turnId: "3", outcome: "completed" } });
    expect(state()).toBe("ended");

    // Stopping a goal whose lead was stopped as idle ends it, with the worker's work undelivered.
    lead?.emit({ type: "turn.started", payload: { turnId: "4" } });
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write again" });
    lead?.emit({ type: "turn.ended", payload: { turnId: "4", outcome: "completed" } });
    await core.registry.stop(lead?.id ?? "", true);
    expect(state()).toBe("idle");
    expect((await core.call("POST", `/tasks/${task.taskId}/stop`)).status).toBe(204);
    expect(state()).toBe("ended");
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
    // The department works on one goal at a time, so the first goal's lead waits.
    const firstLead = core.store.listSessions(first.task.taskId)[0];
    const resumed = await core.call("POST", `/sessions/${firstLead?.id}/resume`, { prompt: "Go" });
    expect(resumed.status).toBe(409);
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

  it("calls in a guest on a copy without instruction files, hands its answer to the lead, lets it leave, and removes the copy with the task", async () => {
    const { task } = await teamAtWork();
    const lead = core.sessions[0];
    const project = join(directory, "bakery");
    writeFileSync(join(project, "menu.md"), "Bread");
    writeFileSync(join(project, "CLAUDE.md"), "Be brief");
    mkdirSync(join(project, ".claude"));

    const outside = await core.callTool(lead, "outsource", { brief: "Check", paths: [".."] });
    expect(outside).toMatchObject({ isError: true, text: expect.stringContaining("workspace") });
    const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
    expect(agents.some((agent) => agent.guest)).toBe(false);
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

    // A deleted task takes the copy with it.
    await core.call("POST", `/tasks/${task.taskId}/stop`);
    expect((await core.call("DELETE", `/tasks/${task.taskId}`)).status).toBe(204);
    expect(existsSync(copy)).toBe(false);
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

  it("hands the user's message to a worker and a note to its lead at work", async () => {
    const { writer, tester } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
    const idOf = (name: string) => agents.find((agent) => agent.name === name)?.id;

    const sent = await core.call("POST", `/agents/${idOf(writer)}/messages`, {
      text: "Use British spelling",
    });

    expect(sent.status).toBe(204);
    expect(lastSent(1)).toEqual({ type: "prompt", text: "Use British spelling" });
    expect(lastSent(0)).toEqual({
      type: "prompt",
      text: `The user told ${writer} directly: "Use British spelling"`,
      origin: { kind: "notice", summary: `The user messaged ${writer}` },
    });
    expect(
      (await core.call("POST", `/agents/${idOf(tester)}/messages`, { text: "Hi" })).status,
    ).toBe(409);
    expect((await core.call("POST", "/agents/nobody/messages", { text: "Hi" })).status).toBe(404);
  });
});

async function teamMembers(): Promise<string[]> {
  const agents = (await core.call("GET", "/agents")).json as AgentRecord[];
  return agents.filter((agent) => agent.role === "Writer").map((agent) => agent.name);
}
