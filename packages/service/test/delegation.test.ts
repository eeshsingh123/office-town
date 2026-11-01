import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentRecord, defaultAccountId } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Core, eventually, playTurn, settle, startCore } from "./support/team-core.ts";

const claude = { harness: "claude", environment: { kind: "native" } };

let directory: string;
let core: Core;

// A department made by hand, with a writer and a tester, starting on a goal.
async function teamAtWork(goal = "Build a bakery site") {
  const project = join(directory, "bakery");
  mkdirSync(project, { recursive: true });
  const workspace = (
    await core.call("POST", "/workspaces", {
      name: "Bakery",
      kind: "folders",
      folders: [{ path: project, access: "edit" }],
    })
  ).json;
  const role = (name: string) => ({ role: name, purpose: `${name}s`, settings: claude });
  const department = (
    await core.call("POST", "/departments", {
      team: { name: "Web team", roles: [role("Writer"), role("Tester")] },
      workspaceIds: [workspace.id],
      autonomy: "full",
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
    expect(busy.text).toContain(`Queued for ${writer}`);
    expect(lastSent(1)).toMatchObject({
      text: expect.stringContaining("And more"),
      origin: { kind: "brief", from: leadAgentId },
    });
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

    // A brief that misses the worker's turn starts its own, and its result still reaches the lead.
    const worker = core.sessions[1];
    await core.callTool(resumed, "delegate", { agent: writer, brief: "Add prices" });
    worker?.emit({ type: "turn.started", payload: { turnId: "turn" } });
    await core.callTool(resumed, "delegate", { agent: writer, brief: "Add hours" });
    worker?.emit({ type: "message", payload: { role: "assistant", text: "Prices are in." } });
    worker?.emit({ type: "turn.ended", payload: { turnId: "turn", outcome: "completed" } });
    playTurn(worker, "Hours are in.");
    await settle();
    expect(resumed?.sent.at(-1)).toMatchObject({ text: `${writer} finished:\nHours are in.` });
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

  it("pauses a whole team past 95% of a usage window and carries it on through its lead on resume", async () => {
    const { task, writer } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const worker = core.sessions[1];
    const limits = [
      {
        id: "five_hour",
        label: "5-hour",
        usedFraction: 0.96,
        resetsAt: "2026-10-23T12:00:00.000Z",
      },
    ];
    worker?.emit({ type: "limits.updated", payload: { limits } });
    await eventually(() => core.store.getTask(task.taskId)?.paused !== undefined);
    await settle();

    expect(core.store.getTask(task.taskId)?.paused).toMatchObject({ window: "5-hour" });
    expect(lastSent(0)).toEqual({ type: "stop" });
    expect(lastSent(1)).toEqual({ type: "stop" });
    expect(core.store.listDelegations(task.taskId).map(({ status }) => status)).toEqual([
      "interrupted",
    ]);

    const accountId = defaultAccountId("claude", { kind: "native" });
    expect((await core.call("POST", `/accounts/${accountId}/resume-paused`, {})).status).toBe(204);
    await eventually(() => core.sessions.length === 3);
    expect(core.store.getTask(task.taskId)?.paused).toBeUndefined();
    expect(core.store.getSession(core.sessions[2]?.id ?? "")?.resumedFrom).toBe(lead?.id);
    expect(lastSent(2)).toMatchObject({
      text: expect.stringContaining("so your team was paused"),
    });
    expect(lastSent(2)).toMatchObject({ text: expect.stringContaining("Write the menu") });
  });

  it("stops a worker only once the user approves its lead's ask, and resumes it in the same conversation", async () => {
    const { writer } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const worker = core.sessions[1];
    worker?.emit({ type: "turn.started", payload: { turnId: "turn" } });
    worker?.emit({ type: "message", payload: { role: "assistant", text: "Testing again." } });
    const ask = () =>
      core.callTool(lead, "stop_work", { agents: [writer], reason: "Too much testing" });
    const answer = async (optionId: string) => {
      const [request] = core.store.listPendingRequests().requests;
      await core.call("POST", `/sessions/${lead?.id}/commands`, {
        type: "answerPermission",
        requestId: request?.event.payload.requestId,
        optionId,
      });
      await settle();
    };

    expect((await ask()).text).toContain("with the user");
    await answer("decline");
    expect(core.registry.isRunning(worker?.id ?? "")).toBe(true);
    expect(lastSent(0)).toMatchObject({ text: expect.stringContaining("declined") });

    await ask();
    expect(worker?.sent.at(-1)?.type).not.toBe("stop");
    await answer("approve");
    expect(worker?.sent.slice(-2).map(({ type }) => type)).toEqual(["interrupt", "stop"]);
    expect(lastSent(0)).toMatchObject({
      text: expect.stringContaining(`${writer}: stopped. Its last words:
Testing again.`),
      origin: { kind: "notice" },
    });
    const ended = core.store
      .readEvents({ after: 0, limit: 100, sessionId: worker?.id ?? "" })
      .find(({ event }) => event.type === "session.ended");
    expect(ended?.event.payload).toMatchObject({
      reason: "stopped",
      stoppedBy: {
        agentId: core.store.getSession(lead?.id ?? "")?.agentId,
        reason: "Too much testing",
      },
    });
    expect((await core.callTool(lead, "team_status", {})).text).toContain("was stopped");

    const resumed = await core.callTool(lead, "resume_work", { agent: writer });
    expect(resumed.text).toContain("carrying on");
    const next = core.sessions.at(-1);
    expect(core.store.getSession(next?.id ?? "")?.resumedFrom).toBe(worker?.id);
    expect(next?.sent.at(-1)).toMatchObject({ text: expect.stringContaining("Write the menu") });
  });

  it("tries a failed worker once, then tells the lead the real error, and resume_work carries it on", async () => {
    const { writer } = await teamAtWork();
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const worker = core.sessions[1];
    const fail = () => {
      worker?.emit({ type: "turn.started", payload: { turnId: "turn" } });
      worker?.emit({ type: "error", payload: { message: "The model refused", fatal: false } });
      worker?.emit({ type: "turn.ended", payload: { turnId: "turn", outcome: "failed" } });
    };

    fail();
    await settle();
    expect(worker?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("Your last turn failed: The model refused"),
    });
    expect(lastSent(0)).not.toMatchObject({ origin: { kind: "result" } });

    fail();
    await settle();
    expect(lastSent(0)).toMatchObject({
      text: expect.stringContaining("The error: The model refused"),
      origin: { kind: "result", outcome: "failed" },
    });
    const status = (await core.callTool(lead, "team_status", {})).text;
    expect(status).toContain("failed on its last piece: The error: The model refused");

    expect((await core.callTool(lead, "resume_work", { agent: writer })).text).toContain(
      "carrying on",
    );
    expect(worker?.sent.at(-1)).toMatchObject({ text: expect.stringContaining("Write the menu") });
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

  it("checks finished work in a temporary worktree from the user's approved list, wants steps for a fail, and leaves nothing behind", async () => {
    const { task } = await teamAtWork();
    const project = join(directory, "bakery");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", project, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        encoding: "utf8",
      });
    git("init", "-q");
    writeFileSync(join(project, "menu.html"), "bread");
    git("add", ".");
    git("commit", "-qm", "menu");
    writeFileSync(join(project, "menu.html"), "bread and cake");
    writeFileSync(join(project, "prices.txt"), "3");
    const lead = core.sessions[0];
    const item = { check: "Open menu.html", expected: "It lists cake" };
    await core.callTool(lead, "write_checklist", {
      items: [item],
      setup: "Open the file in a browser",
      changes: "Added cake to the menu",
    });
    playTurn(lead, "The menu is done.");
    await settle();

    const started = await core.call("POST", `/tasks/${task.taskId}/checks`, {
      reviewer: { settings: claude },
    });
    expect(started.json).toMatchObject({ status: "drafting", sandbox: "worktree", round: 1 });
    const checker = core.sessions.at(-1);
    const work = core.store.getSession(started.json.checkerSessionId)?.options.workspacePath ?? "";
    // Uncommitted and new files reach the checker; the owner's folder is never touched.
    expect(readFileSync(join(work, "menu.html"), "utf8")).toBe("bread and cake");
    expect(existsSync(join(work, "prices.txt"))).toBe(true);
    expect(execFileSync("git", ["-C", work, "status", "--short"], { encoding: "utf8" })).toBe(
      git("status", "--short"),
    );
    const brief = checker?.sent.find((sent) => sent.type === "prompt");
    expect(brief && "text" in brief ? brief.text : "").toContain("Open menu.html");

    await core.callTool(checker, "propose_checks", {
      items: [
        { ...item, fromLead: true },
        { check: "Open it with no prices", expected: "No error" },
      ],
    });
    const asked = core.store
      .listPendingRequests()
      .requests.find(({ event }) => event.type === "checklist.requested");
    // The user drops the checker's case and adds one of their own.
    const approved = [
      { id: "c1", ...item, from: "lead" },
      { id: "u1", check: "Open it on a phone", expected: "It fits", from: "user" },
    ];
    await core.call("POST", `/sessions/${checker?.id}/commands`, {
      type: "answerChecklist",
      requestId: asked?.event.payload.requestId,
      answer: { outcome: "approved", items: approved },
    });
    const vague = { id: "u1", outcome: "fail", evidence: "Looked on a phone" };
    const pass = { id: "c1", outcome: "pass", evidence: "Cake is listed" };
    expect(
      (await core.callTool(checker, "report_check", { results: [pass, vague] })).text,
    ).toContain("steps to reproduce");
    const fail = { ...vague, steps: "Open at 375 px wide", got: "The menu overflows" };
    await core.callTool(checker, "report_check", { results: [pass, fail], notes: ["No favicon"] });
    playTurn(checker, "Checked.");

    await eventually(() => core.store.checkSandboxes().length === 0);
    expect(existsSync(join(work, ".."))).toBe(false);
    expect(core.store.getCheck(started.json.id)).toMatchObject({
      status: "done",
      items: approved,
      results: [pass, fail],
      notes: ["No favicon"],
    });
    expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    expect(readFileSync(join(project, "menu.html"), "utf8")).toBe("bread and cake");
  });
});
