import type { SessionEvent } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent, Translation } from "../src/adapter.ts";
import type { Environment } from "../src/environment/environment.ts";
import { HarnessSession } from "../src/session.ts";
import { replayOptions, ScriptedEnvironment } from "./support/replay.ts";

// A harness whose native format is already our events, so these tests exercise only the session.
const passthroughAdapter: Adapter = {
  harness: "replayed",
  name: "Replayed",
  maker: "Test",
  summary: "Replays its input.",
  needs: "Nothing",
  capabilities: {
    reasoning: false,
    plan: true,
    effort: false,
    modelList: false,
    resume: false,
    usageLimits: false,
    images: false,
    isolation: "none",
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

async function startSession(environment: Environment = new ScriptedEnvironment()) {
  const session = new HarnessSession(replayOptions, passthroughAdapter, environment);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.send({ type: "start" });
  const emit = (...adapterEvents: AdapterEvent[]) =>
    (environment as ScriptedEnvironment).emitLine(JSON.stringify(adapterEvents));
  return { session, events, emit };
}

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
});
