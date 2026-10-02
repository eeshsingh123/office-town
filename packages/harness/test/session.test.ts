import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent, Translation } from "../src/adapter.ts";
import type { Environment } from "../src/environment/environment.ts";
import { HarnessSession, SessionStateError } from "../src/session.ts";
import { replayOptions, ScriptedEnvironment } from "./support/replay.ts";

// A harness whose native format is already our events, so these tests exercise only the session.
const passthroughAdapter: Adapter = {
  harness: "replayed",
  capabilities: { reasoning: false, plan: true, effort: false, modelList: false, resume: false },
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
    interrupt: () => ({ events: [], outgoing: ["interrupt"] }),
  }),
};

async function startSession(environment: Environment = new ScriptedEnvironment()) {
  const session = new HarnessSession(replayOptions, passthroughAdapter, environment);
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

  it("gives each turn an id shared by its start and end", async () => {
    const { events, emit } = await startSession();

    await emit({ type: "turn.started" }, { type: "turn.ended", payload: { outcome: "completed" } });
    await emit({ type: "turn.started" }, { type: "turn.ended", payload: { outcome: "completed" } });

    const turnIds = events.map((event) => (event.payload as { turnId: string }).turnId);
    expect(turnIds[0]).toBe(turnIds[1]);
    expect(turnIds[2]).toBe(turnIds[3]);
    expect(turnIds[0]).not.toBe(turnIds[2]);
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
    const environment: Environment = {
      launch: () => Promise.reject(new Error("not installed")),
    };
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

  it("reports output it cannot read and keeps going", async () => {
    const environment = new ScriptedEnvironment();
    const { events } = await startSession(environment);

    await environment.emitLine("not json");
    await environment.emitLine(JSON.stringify([{ type: "turn.started" }]));

    expect(events.map((event) => event.type)).toEqual(["error", "turn.started"]);
    expect(events[0]?.payload).toMatchObject({ detail: "not json", fatal: false });
  });
});
