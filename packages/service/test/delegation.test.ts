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
  it("starts workers on their pieces at once and hands each result to the lead, resuming it if it was left idle, and once per piece when a sub-agent outlives the worker's turn", async () => {
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

    // A turn that ends with a background sub-agent at work: the lead hears once, the result waits.
    await core.callTool(resumed, "delegate", { agent: writer, brief: "Check every page" });
    worker?.emit({ type: "turn.started", payload: { turnId: "turn" } });
    worker?.emit({
      type: "action.started",
      payload: { actionId: "sub", kind: "delegate", title: "Find every page", input: {} },
    });
    worker?.emit({ type: "message", payload: { role: "assistant", text: "A sub-agent looks." } });
    worker?.emit({ type: "turn.ended", payload: { turnId: "turn", outcome: "completed" } });
    await settle();
    const heard = resumed?.sent.length ?? 0;
    expect(resumed?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("1 sub-agent is still running (Find every page)"),
      origin: { kind: "interim" },
    });
    expect((await core.callTool(resumed, "team_status", {})).text).toContain(
      `${writer}, Writer (claude): is waiting on 1 sub-agent`,
    );
    // Its CLI starts no turn of its own, so the worker is asked to take the sub-agent's work in.
    worker?.emit({
      type: "action.ended",
      payload: { actionId: "sub", outcome: "completed", result: "Found 4 pages." },
    });
    await settle();
    expect(worker?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("Your sub-agents have finished"),
    });
    playTurn(worker, "All 4 pages checked.");
    await settle();
    expect(resumed?.sent.slice(heard)).toEqual([
      expect.objectContaining({ text: `${writer} finished:\nAll 4 pages checked.` }),
    ]);
  });

  it("hands an idle lead every result that comes at once, in order; with Milestones on, a part with every milestone met is done at once, and a lead sends a part back at most twice before the user decides", async () => {
    const { writer, tester, task } = await teamAtWork();
    const lead = core.sessions[0];
    // Milestones off: the brief reads as before.
    expect(JSON.stringify(lead?.sent)).not.toContain("milestone");
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

    // Turned on mid-task: the lead keeps the goal's list; a worker reports its part's.
    await core.call("PUT", `/tasks/${task.taskId}/options`, { milestones: true });
    const resumed = core.sessions.at(-1);
    const goal = { outcome: "A menu page", see: "Open menu.html" };
    expect((await core.callTool(resumed, "set_milestones", { milestones: [goal] })).text).toContain(
      "M1. A menu page",
    );
    const part = (outcome: string) => [{ outcome, see: "Open the page" }];
    const bare = await core.callTool(resumed, "delegate", { agent: writer, brief: "Prices" });
    expect(bare.isError).toBe(true);
    await core.callTool(resumed, "delegate", {
      agent: writer,
      brief: "Add prices",
      title: "Prices",
      milestones: part("Prices show"),
    });
    expect(JSON.stringify(core.sessions[1]?.sent.at(-1))).toContain("M2. Prices show");
    await core.callTool(core.sessions[1], "report_milestone", {
      id: "M2",
      met: true,
      proof: "Opened it.",
    });
    playTurn(core.sessions[1], "Prices are in.");
    await settle();
    const done = core.store.listDelegations(task.taskId).at(-1);
    expect(done?.accepted).toBe("new");
    expect(resumed?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining('"Prices": its milestone is met, so it is done'),
    });

    // Not met: sent back twice, then the user decides.
    await core.callTool(resumed, "delegate", {
      agent: tester,
      brief: "Test prices",
      title: "Price tests",
      milestones: part("Tests pass"),
    });
    await core.callTool(core.sessions[2], "report_milestone", {
      id: "M3",
      met: false,
      proof: "Two fail.",
    });
    playTurn(core.sessions[2], "Two tests fail.");
    await settle();
    const sendBack = { agent: tester, milestones: ["M3"], note: "Fix the failing tests" };
    for (const round of [1, 2]) {
      const sent = await core.callTool(resumed, "send_back", sendBack);
      expect(sent.text).toContain(`(${round} of 2)`);
      expect(JSON.stringify(core.sessions[2]?.sent.at(-1))).toContain("sent your part back");
      playTurn(core.sessions[2], "Still failing.");
      await settle();
    }
    const third = await core.callTool(resumed, "send_back", sendBack);
    expect(third.text).toContain("with the user");
    const asked = core.store
      .listPendingRequests()
      .requests.find(({ event }) => event.sessionId === resumed?.id);
    expect(JSON.stringify(asked?.event)).toContain("was sent back twice");
    await core.call("POST", `/sessions/${resumed?.id}/commands`, {
      type: "answerQuestion",
      requestId: asked?.event.payload.requestId,
      answers: [{ questionId: "1", selected: ["Accept as is"] }],
    });
    await settle();
    expect(resumed?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("accepted"),
    });

    // A part sent back after it was accepted is no longer accepted.
    await core.callTool(resumed, "send_back", { agent: writer, milestones: ["M2"], note: "Wrong" });
    const reopened = core.store.listDelegations(task.taskId).find((one) => one.id === done?.id);
    expect(reopened).toMatchObject({ status: "working", sendBacks: [{ note: "Wrong" }] });
    expect(reopened?.accepted).toBeUndefined();
  });

  it("carries a lead and a worker on in a new session with a complete handover: One place suggests it, Efficient asks mid-turn, the piece and its result stay whole, and an agent's own ask waits for the user", async () => {
    const { task, writer } = await teamAtWork();
    const taskId = task.taskId as string;
    const lead = core.sessions[0];
    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const worker = core.sessions[1];
    const [piece] = core.store.listDelegations(taskId);
    const results = () =>
      core.sessions.flatMap((one) =>
        one.sent.filter(
          (command) => command.type === "prompt" && command.origin?.kind === "result",
        ),
      );
    const note = {
      decisions: ["Plain HTML: the user wants no build step"],
      facts: ["The site opens from index.html"],
      next: "Add the prices",
    };
    const approve = async (session: typeof lead, optionId: string) => {
      const asked = core.store
        .listPendingRequests()
        .requests.find(({ event }) => event.sessionId === session?.id)?.event;
      expect(asked?.type).toBe("permission.requested");
      await core.call("POST", `/sessions/${session?.id}/commands`, {
        type: "answerPermission",
        requestId: asked?.payload.requestId,
        optionId,
      });
      await settle();
    };

    // One place: past 300k with work out, the lead's suggestion waits in Needs you.
    lead?.emit({ type: "turn.started", payload: { turnId: "turn" } });
    lead?.emit({
      type: "turn.ended",
      payload: {
        turnId: "turn",
        outcome: "completed",
        usage: { inputTokens: 1, outputTokens: 1, contextTokens: 310_000 },
      },
    });
    await settle();
    await approve(lead, "approve");
    expect(lead?.sent.at(-1)).toMatchObject({ text: expect.stringContaining("Call hand_over") });
    expect((await core.callTool(lead, "hand_over", note)).text).toContain("saved");
    playTurn(lead, "Handover written.");
    await eventually(() => core.sessions.length === 3);
    await settle();
    const newLead = core.sessions.at(-1);
    expect(newLead?.sent.at(-1)).toMatchObject({
      origin: { kind: "handover", fromSessionId: lead?.id },
      text: expect.stringMatching(/Plain HTML[\s\S]*Work handed out[\s\S]*Write the menu/),
    });
    expect(core.store.getSession(lead?.id ?? "")?.status).toBe("exited");

    // Efficient: past the size, the worker is asked during its turn and writes its own handover.
    // Its window is not reported yet: the same model's, reported by the lead, stands in for it.
    newLead?.emit({
      type: "context.measured",
      payload: { contextTokens: 10, contextWindow: 2000 },
    });
    const switched = await core.call("PUT", `/tasks/${taskId}/options`, { efficient: true });
    expect(switched.json.efficient).toBe(true);
    worker?.emit({ type: "turn.started", payload: { turnId: "turn" } });
    worker?.emit({ type: "context.measured", payload: { contextTokens: 1700 } });
    await settle();
    expect(worker?.sent.at(-1)).toMatchObject({
      origin: { kind: "notice", summary: "Asked to carry on in a new session" },
    });
    const written = await core.callTool(worker, "hand_over", {
      ...note,
      progress: "The menu is written; the prices are left",
      steps: ["done: menu", "next: prices"],
    });
    expect(written.text).toContain("saved");
    // A brief sent during the switch waits for the new session.
    const queued = await core.callTool(newLead, "delegate", { agent: writer, brief: "Add hours" });
    expect(queued.text).toContain(`Queued for ${writer}`);
    expect(worker?.sent.at(-1)).not.toMatchObject({ text: expect.stringContaining("Add hours") });
    worker?.emit({ type: "message", payload: { role: "assistant", text: "Handover written." } });
    worker?.emit({ type: "turn.ended", payload: { turnId: "turn", outcome: "completed" } });
    await eventually(() => core.sessions.length === 4);
    await settle();

    const newWorker = core.sessions.at(-1);
    const prompts = newWorker?.sent.filter((command) => command.type === "prompt");
    expect(prompts?.[0]).toMatchObject({
      origin: { kind: "handover", fromSessionId: worker?.id },
      text: expect.stringMatching(
        /Write the menu[\s\S]*Programs left running stopped[\s\S]*the prices are left[\s\S]*next: prices/,
      ),
    });
    expect(prompts?.[1]).toMatchObject({ text: expect.stringContaining("Add hours") });
    expect(core.store.getSession(newWorker?.id ?? "")?.options.workspacePath).toBe(
      core.store.getSession(worker?.id ?? "")?.options.workspacePath,
    );
    expect(core.store.listDelegations(taskId)).toEqual([
      expect.objectContaining({ id: piece?.id, status: "working", workerSessionId: newWorker?.id }),
    ]);
    expect(results()).toEqual([]);

    // Its result reaches the new lead once.
    playTurn(newWorker, "Menu, prices and hours are in.");
    await settle();
    expect(results()).toEqual([
      expect.objectContaining({ text: `${writer} finished:\nMenu, prices and hours are in.` }),
    ]);
    expect(newLead?.sent.at(-1)).toMatchObject({ origin: { kind: "result" } });

    // Each handover is a Markdown file in Outputs, cleared only once the task is done.
    const outputs = (await core.call("GET", `/tasks/${taskId}/outputs`)).json;
    expect(outputs.handovers.map((file: { sessionId: string }) => file.sessionId)).toEqual([
      lead?.id,
      worker?.id,
    ]);
    const markdown = readFileSync(
      join(directory, "data", "handovers", taskId, `${worker?.id}.md`),
      "utf8",
    );
    expect(markdown).toMatch(
      /^# .+'s handover[\s\S]*### Where the part stands[\s\S]*## Earlier conversation/,
    );
    expect((await core.call("DELETE", `/tasks/${taskId}/handovers`)).status).toBe(409);

    // An agent's own ask goes to Needs you; Deny keeps the session.
    const own = await core.callTool(newLead, "hand_over", note);
    expect(own.text).toContain("Needs you");
    const sessions = core.sessions.length;
    await approve(newLead, "decline");
    expect(newLead?.sent.at(-1)).toMatchObject({
      text: expect.stringContaining("keep this session"),
    });
    expect(core.sessions).toHaveLength(sessions);
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
    // Everyone starts it in a new conversation, the lead and a worker it hands work to.
    const newLead = core.sessions.at(-1);
    await core.callTool(newLead, "delegate", { agent: first.writer, brief: "Write again" });
    expect(
      core.store.listSessions(second.taskId).map(({ options }) => options.resumeSessionId),
    ).toEqual([undefined, undefined]);
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

  it("tells the lead at once when a worker cannot start, tries a failed worker once, then tells the lead the real error, and resume_work carries it on", async () => {
    const { department, task, writer, tester } = await teamAtWork();
    const lead = core.sessions[0];
    const members = (await core.call("GET", "/agents")).json as AgentRecord[];
    const keep = (name: string, model?: string) => {
      const member = members.find((agent) => agent.name === name);
      return {
        role: member?.role ?? "",
        purpose: member?.purpose ?? "",
        agentId: member?.id,
        settings: { ...claude, ...(model === undefined ? {} : { model }) },
      };
    };
    await core.call("PUT", `/departments/${department.id}/team`, {
      name: "Web team",
      roles: [keep(writer), keep(tester, "broken")],
    });
    const refused = await core.callTool(lead, "delegate", { agent: tester, brief: "Test" });
    expect(refused).toMatchObject({
      isError: true,
      text: expect.stringContaining("could not start"),
    });
    expect(core.store.listDelegations(task.taskId)).toEqual([]);

    await core.callTool(lead, "delegate", { agent: writer, brief: "Write the menu" });
    const worker = core.sessions.at(-1);
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

  it("stops a whole team without waking its lead, and after a restart a message to its lead continues it with the work that was cut off", async () => {
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

    // From the lead's chat, not Continue: the cut-off work must not hold the department forever.
    const leadId = core.store.getTask(second.taskId)?.leadAgentId;
    const told = await core.call("POST", `/agents/${leadId}/messages`, {
      text: "Go on",
      taskId: second.taskId,
    });
    expect(told.status).toBe(204);
    expect(core.sessions[0]?.sent.at(-1)).toMatchObject({
      text: expect.stringMatching(new RegExp(`- ${first.writer}: Write the second menu[^]*Go on$`)),
      origin: { kind: "notice" },
    });
    expect(core.store.listDelegations(second.taskId).map((one) => one.status)).toEqual(["stopped"]);
  });

  it("checks finished work in a temporary worktree from the user's approved list, wants steps for a fail, and leaves nothing behind", async () => {
    const { task, department } = await teamAtWork();
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
    // Everyone is done, but a check holds the department, even between the checker's turns.
    const newGoal = { goal: "Next goal", team: { departmentId: department.id } };
    checker?.emit({ type: "turn.started", payload: { turnId: "1" } });
    checker?.emit({ type: "turn.ended", payload: { turnId: "1", outcome: "completed" } });
    expect((await core.call("POST", "/tasks/team", newGoal)).status).toBe(409);
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

    // The check is over, so the department is free; old work is not checked during new work.
    expect((await core.call("POST", "/tasks/team", newGoal)).status).toBe(201);
    const again = await core.call("POST", `/tasks/${task.taskId}/checks`, {
      reviewer: { settings: claude },
    });
    expect(again.status).toBe(409);
  });
});
