import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent, LaunchOptions, Translation } from "../src/adapter.ts";
import type { Environment } from "../src/environment/environment.ts";
import { listHarnesses } from "../src/index.ts";
import { HarnessSession, SessionStateError } from "../src/session.ts";
import { replayOptions, ScriptedEnvironment } from "./support/replay.ts";

// A harness whose native format is already our events, so these tests exercise only the session.
const passthroughAdapter: Adapter = {
  harness: "replayed",
  capabilities: {
    reasoning: false,
    plan: true,
    effort: false,
    modelList: false,
    resume: false,
    usageLimits: false,
  },
  buildCommand: () => ({ binary: "replayed", args: [] }),
  createTranslator: () => ({
    open: () => [],
    receive: (line) =>
      ({ events: JSON.parse(line) as AdapterEvent[], outgoing: [] }) as Translation,
    prompt: (text) => ({ events: [], outgoing: [text] }),
    answerPermission: (requestId, option) => ({
      events: [],
      outgoing: [`${requestId}:${option.optionId}`],
    }),
    answerQuestion: (requestId, answered) => ({
      events: [],
      outgoing: [`${requestId}:${answered.map((a) => a.selected.join("+")).join(",")}`],
    }),
    interrupt: () => ({ events: [], outgoing: ["interrupt"] }),
  }),
};

async function startSession(
  environment: Environment = new ScriptedEnvironment(),
  options: LaunchOptions = replayOptions,
) {
  const session = new HarnessSession(options, passthroughAdapter, environment);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.send({ type: "start" });
  const emit = (...adapterEvents: AdapterEvent[]) =>
    (environment as ScriptedEnvironment).emitLine(JSON.stringify(adapterEvents));
  return { session, events, emit };
}

const action = (actionId: string, parentActionId?: string): AdapterEvent => ({
  type: "action.started",
  payload: {
    actionId,
    kind: "other",
    title: actionId,
    input: {},
    ...(parentActionId === undefined ? {} : { parentActionId }),
  },
});

const turn = (
  inputTokens: number,
  totalCostUsd?: number,
  cachedInputTokens = 0,
): AdapterEvent[] => [
  { type: "turn.started" },
  {
    type: "turn.ended",
    payload: {
      outcome: "completed",
      usage: { inputTokens, outputTokens: 0, cachedInputTokens },
      ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
    },
  },
];

const budgetRequest = (events: SessionEvent[]) =>
  events.findLast((event) => event.type === "permission.requested")?.payload;

const permission: AdapterEvent = {
  type: "permission.requested",
  payload: {
    requestId: "request-1",
    title: "Write a file",
    input: {},
    options: [
      { optionId: "yes", label: "Allow", kind: "allow_once" },
      { optionId: "no", label: "Deny", kind: "reject_once" },
    ],
  },
};

describe("session", () => {
  it("attributes a top-level action to the plan step in progress, but not a nested one", async () => {
    const { events, emit } = await startSession();

    await emit(action("before-plan"));
    await emit({
      type: "plan.updated",
      payload: {
        steps: [
          { id: "1", title: "done", status: "completed" },
          { id: "2", title: "doing", status: "in_progress" },
        ],
      },
    });
    await emit(action("top-level"), action("nested", "top-level"));

    const started = events.filter((event) => event.type === "action.started");
    expect(started.map((event) => event.payload.planStepId)).toEqual([undefined, "2", undefined]);
  });

  it("hands the adapter environment paths and reports locations as host paths", async () => {
    const environment = new ScriptedEnvironment();
    environment.toEnvironmentPath = (hostPath) => `inside:${hostPath}`;
    environment.toHostPath = (environmentPath) => `host:${environmentPath}`;
    const { events, emit } = await startSession(environment);

    await emit({
      type: "action.started",
      payload: { actionId: "a", kind: "edit", title: "edit", input: {}, locations: ["/x/file"] },
    });

    expect(environment.request?.cwd).toBe("inside:/workspace");
    expect(events[0]?.payload).toMatchObject({ locations: ["host:/x/file"] });
  });

  it("gives each turn an id shared by its start and end", async () => {
    const { events, emit } = await startSession();

    await emit({ type: "turn.started" }, { type: "turn.ended", payload: { outcome: "completed" } });
    await emit({ type: "turn.started" }, { type: "turn.ended", payload: { outcome: "completed" } });

    const turnIds = events.map((event) => (event.payload as { turnId: string }).turnId);
    expect(turnIds[0]).toBe(turnIds[1]);
    expect(turnIds[2]).toBe(turnIds[3]);
    expect(turnIds[0]).not.toBe(turnIds[2]);
  });

  it("turns the harness's running cost into the cost of each turn", async () => {
    const { events, emit } = await startSession();

    await emit(...turn(10, 0.25), ...turn(10, 0.4), ...turn(10));

    const usage = events
      .filter((event) => event.type === "turn.ended")
      .map((event) => event.payload.usage);
    expect(usage[0]?.costUsd).toBeCloseTo(0.25);
    expect(usage[1]?.costUsd).toBeCloseTo(0.15);
    expect(usage[2]).toEqual({ inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 });
  });

  it("asks before continuing once the token budget is used, leaving cached input out", async () => {
    const options = { ...replayOptions, budget: { maxTokens: 100 } };
    const { session, events, emit } = await startSession(new ScriptedEnvironment(), options);

    await emit(...turn(1000, undefined, 940));
    expect(budgetRequest(events)).toBeUndefined();

    await emit(...turn(50));
    expect(budgetRequest(events)).toEqual({
      requestId: "budget-1",
      title: "Budget reached: 110 of 100 tokens used. Continue?",
      input: { spent: { tokens: 110, costUsd: 0 }, limit: { maxTokens: 100 } },
      options: [
        { optionId: "continue", label: "Continue with the same budget again", kind: "allow_once" },
        { optionId: "stop", label: "Stop the agent", kind: "reject_once" },
      ],
    });
    await expect(session.send({ type: "prompt", text: "more" })).rejects.toBeInstanceOf(
      SessionStateError,
    );
  });

  it("grants the same budget again when the user continues, without telling the harness", async () => {
    const environment = new ScriptedEnvironment();
    const options = { ...replayOptions, budget: { maxCostUsd: 1 } };
    const { session, events, emit } = await startSession(environment, options);
    await emit(...turn(10, 1.2));

    await session.send({ type: "answerPermission", requestId: "budget-1", optionId: "continue" });
    await session.send({ type: "prompt", text: "more" });
    await emit(...turn(10, 2.1));
    expect(budgetRequest(events)?.requestId).toBe("budget-1");

    await emit(...turn(10, 2.2));
    expect(environment.written).toEqual(["more"]);
    expect(events.find((event) => event.type === "permission.resolved")?.payload).toEqual({
      requestId: "budget-1",
      outcome: "allowed",
      optionId: "continue",
    });
    expect(budgetRequest(events)).toMatchObject({
      requestId: "budget-2",
      title: "Budget reached: $2.20 of $2.20 used. Continue?",
    });
  });

  it("stops the session when the user declines to continue past the budget", async () => {
    const options = { ...replayOptions, budget: { maxTokens: 100 } };
    const { session, events, emit } = await startSession(new ScriptedEnvironment(), options);
    await emit(...turn(200));

    await session.send({ type: "answerPermission", requestId: "budget-1", optionId: "stop" });

    expect(events.slice(-2).map((event) => [event.type, event.payload])).toEqual([
      ["permission.resolved", { requestId: "budget-1", outcome: "denied", optionId: "stop" }],
      ["session.ended", { reason: "stopped", exitCode: 0 }],
    ]);
  });

  it("answers a pending permission once and reports how it was resolved", async () => {
    const environment = new ScriptedEnvironment();
    const { session, events, emit } = await startSession(environment);
    await emit(permission);

    await session.send({ type: "answerPermission", requestId: "request-1", optionId: "no" });

    expect(environment.written).toEqual(["request-1:no"]);
    expect(events.at(-1)).toMatchObject({
      type: "permission.resolved",
      payload: { requestId: "request-1", outcome: "denied", optionId: "no" },
    });
    await expect(
      session.send({ type: "answerPermission", requestId: "request-1", optionId: "no" }),
    ).rejects.toBeInstanceOf(SessionStateError);
  });

  it("answers a pending question only when every question has an answer", async () => {
    const environment = new ScriptedEnvironment();
    const { session, events, emit } = await startSession(environment);
    const question = (questionId: string) => ({
      questionId,
      text: `Question ${questionId}?`,
      options: [{ label: "Red" }, { label: "Blue" }],
      multiSelect: true,
    });
    await emit({
      type: "question.requested",
      payload: { requestId: "ask-1", questions: [question("1"), question("2")] },
    });

    const first = { questionId: "1", selected: ["Red", "Blue"] };
    await expect(
      session.send({ type: "answerQuestion", requestId: "ask-1", answers: [first] }),
    ).rejects.toBeInstanceOf(SessionStateError);
    const answers = [first, { questionId: "2", selected: ["Neither"] }];
    await session.send({ type: "answerQuestion", requestId: "ask-1", answers });

    expect(environment.written).toEqual(["ask-1:Red+Blue,Neither"]);
    expect(events.at(-1)).toMatchObject({
      type: "question.resolved",
      payload: { requestId: "ask-1", outcome: "answered", answers },
    });
  });

  it("rejects commands the current state does not allow", async () => {
    const session = new HarnessSession(
      replayOptions,
      passthroughAdapter,
      new ScriptedEnvironment(),
    );

    await expect(session.send({ type: "prompt", text: "hi" })).rejects.toBeInstanceOf(
      SessionStateError,
    );
    await session.send({ type: "start" });
    await expect(session.send({ type: "start" })).rejects.toBeInstanceOf(SessionStateError);
    await session.send({ type: "stop" });
    await expect(session.send({ type: "interrupt" })).rejects.toBeInstanceOf(SessionStateError);
  });

  it("reports a harness that cannot be launched and ends the session as failed", async () => {
    const environment = new ScriptedEnvironment();
    environment.launch = () => Promise.reject(new Error("not installed"));
    const { events } = await startSession(environment);

    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ["error", { message: "not installed", fatal: true }],
      ["session.ended", { reason: "failed", exitCode: null }],
    ]);
  });

  it("closes the open turn and pending permissions when the harness dies", async () => {
    const environment = new ScriptedEnvironment();
    const { events, emit } = await startSession(environment);
    await emit({ type: "turn.started" }, permission);
    const settled = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (events.at(-1)?.type !== "session.ended") return;
        clearInterval(check);
        resolve();
      }, 5);
    });

    environment.exit({ code: 1, signal: null }, "fatal: boom");
    await settled;

    expect(events.slice(-4).map((event) => [event.type, event.payload])).toEqual([
      ["permission.resolved", { requestId: "request-1", outcome: "cancelled" }],
      ["turn.ended", { outcome: "failed", turnId: expect.any(String) }],
      [
        "error",
        {
          message: "The harness exited unexpectedly (code 1).",
          detail: "fatal: boom",
          fatal: true,
        },
      ],
      ["session.ended", { reason: "failed", exitCode: 1 }],
    ]);
  });

  it("fails the actions still running when the harness dies", async () => {
    const environment = new ScriptedEnvironment();
    const { session, events, emit } = await startSession(environment);
    await emit(action("finished"), action("running"), {
      type: "action.ended",
      payload: { actionId: "finished", outcome: "completed", result: "ok" },
    });

    await session.send({ type: "stop" });

    const ended = events.filter((event) => event.type === "action.ended");
    expect(ended.map((event) => [event.payload.actionId, event.payload.outcome])).toEqual([
      ["finished", "completed"],
      ["running", "failed"],
    ]);
  });

  it("stops a session that is still starting once the launch settles", async () => {
    const environment = new ScriptedEnvironment();
    const launch = environment.launch.bind(environment);
    const gate = Promise.withResolvers<void>();
    environment.launch = async (request) => {
      await gate.promise;
      return launch(request);
    };
    const session = new HarnessSession(replayOptions, passthroughAdapter, environment);
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));

    const started = session.send({ type: "start" });
    const stopped = session.send({ type: "stop" });
    gate.resolve();
    await Promise.all([started, stopped]);

    expect(events.at(-1)).toMatchObject({ type: "session.ended", payload: { reason: "stopped" } });
  });

  it("keeps going when a subscriber throws, and reports it", async () => {
    const environment = new ScriptedEnvironment();
    const session = new HarnessSession(replayOptions, passthroughAdapter, environment);
    const events: SessionEvent[] = [];
    session.subscribe(() => {
      throw new Error("store is full");
    });
    session.subscribe((event) => events.push(event));
    await session.send({ type: "start" });

    await environment.emitLine(JSON.stringify([{ type: "turn.started" }]));
    await session.send({ type: "stop" });

    expect(events[0]?.type).toBe("turn.started");
    expect(events[1]).toMatchObject({
      type: "error",
      payload: { message: "A subscriber failed to handle an event: store is full", fatal: false },
    });
    expect(events.at(-1)?.type).toBe("session.ended");
  });

  it("says so when the harness cannot use the chosen effort", async () => {
    const session = new HarnessSession(
      { ...replayOptions, effort: "high" },
      passthroughAdapter,
      new ScriptedEnvironment(),
    );
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.send({ type: "start" });

    expect(events[0]).toMatchObject({ type: "error", payload: { fatal: false } });
    expect(events[0]?.payload).toMatchObject({ message: expect.stringContaining('"high"') });
  });

  it("lists each harness with what it supports", () => {
    expect(listHarnesses().map((description) => description.harness)).toEqual([
      "claude",
      "opencode",
    ]);
    expect(listHarnesses()[0]?.capabilities).toMatchObject({ plan: true });
  });

  it("reports output it cannot read and keeps going", async () => {
    const environment = new ScriptedEnvironment();
    const { events } = await startSession(environment);

    await environment.emitLine("not json");
    await environment.emitLine(JSON.stringify([{ type: "turn.started" }]));

    expect(events.map((event) => event.type)).toEqual(["error", "turn.started"]);
    expect(events[0]?.payload).toMatchObject({ detail: "not json", fatal: false });
  });
});
