import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Trigger } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catchUp, missedSince, nextRuns } from "../src/automations/clock.ts";
import { startFakeServices } from "./support/fake-services.ts";
import { type Core, eventually, playTurn, settle, startCore } from "./support/team-core.ts";

type ScheduleTrigger = Extract<Trigger, { kind: "schedule" }>;

const daily = (time: string, timeZone = "UTC"): ScheduleTrigger => ({
  kind: "schedule",
  schedule: { repeat: "daily", time },
  timeZone,
  ends: { kind: "never" },
});

const at = (iso: string) => new Date(iso);
const times = (dates: Date[]) => dates.map((date) => date.toISOString());

describe("the clock", () => {
  it("keeps each schedule's zone through daylight saving, counts missed runs once and catches up only within its window", () => {
    const rows: { name: string; got: unknown; want: unknown }[] = [
      {
        name: "a time skipped by spring forward runs at the first valid time",
        got: times(nextRuns(daily("02:30", "Europe/Berlin"), at("2027-03-27T12:00:00Z"), 2)),
        want: ["2027-03-28T01:00:00.000Z", "2027-03-29T00:30:00.000Z"],
      },
      {
        name: "a time that happens twice at fall back runs once",
        got: times(nextRuns(daily("02:30", "Europe/Berlin"), at("2027-10-30T12:00:00Z"), 2)),
        want: ["2027-10-31T00:30:00.000Z", "2027-11-01T01:30:00.000Z"],
      },
      {
        name: "each schedule keeps its own zone, whatever the computer's",
        got: times([
          ...nextRuns(daily("09:00", "America/New_York"), at("2026-11-23T00:00:00Z"), 1),
          ...nextRuns(daily("09:00", "Asia/Tokyo"), at("2026-11-23T00:00:00Z"), 1),
        ]),
        want: ["2026-11-23T14:00:00.000Z", "2026-11-24T00:00:00.000Z"],
      },
      {
        name: "Ends after N runs stops at N",
        got: nextRuns(
          { ...daily("09:00"), ends: { kind: "after", runs: 3 } },
          at("2026-11-23T00:00:00Z"),
          3,
          at("2026-11-21T00:00:00Z"),
        ).length,
        want: 1,
      },
      {
        name: "a run missed 6 hours ago is caught up within 12 hours",
        got: (() => {
          const missed = missedSince(
            daily("09:00"),
            at("2026-11-20T09:00:00Z"),
            at("2026-11-20T15:00:00Z"),
          );
          return (
            missed && {
              count: missed.count,
              catchUp: catchUp(missed, 12, at("2026-11-20T15:00:00Z")),
            }
          );
        })(),
        want: { count: 1, catchUp: true },
      },
      {
        name: "runs missed past the window become one record with the count",
        got: (() => {
          const missed = missedSince(
            daily("09:00"),
            at("2026-11-20T09:00:00Z"),
            at("2026-11-21T22:00:00Z"),
          );
          return (
            missed && {
              count: missed.count,
              catchUp: catchUp(missed, 12, at("2026-11-21T22:00:00Z")),
            }
          );
        })(),
        want: { count: 2, catchUp: false },
      },
      {
        name: "a week away catches up its latest run only",
        got: (() => {
          const missed = missedSince(
            daily("09:00"),
            at("2026-11-01T09:00:00Z"),
            at("2026-11-08T10:00:00Z"),
          );
          return missed && { count: missed.count, latest: missed.latest.toISOString() };
        })(),
        want: { count: 8, latest: "2026-11-08T09:00:00.000Z" },
      },
    ];
    for (const row of rows) expect(row.got, row.name).toEqual(row.want);
  });
});

let directory: string;
let core: Core;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "office-town-automations-"));
  core = await startCore(join(directory, "data"));
});

afterEach(async () => {
  await core.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the runner", () => {
  it("writes a run under its key before it starts, never fires a slot or an event twice, and makes a burst of events one run", async () => {
    const scratch = core.store.listWorkspaces().find((workspace) => workspace.kind === "scratch");
    if (scratch === undefined) throw new Error("Scratch always exists.");
    const created = await core.call("POST", "/automations", {
      name: "Morning notes",
      task: {
        kind: "assistant",
        request: {
          prompt: "Write today's notes for {date}.",
          agent: { settings: { harness: "claude", environment: { kind: "native" } } },
          autonomy: "full",
          workspaceId: scratch.id,
        },
      },
      trigger: daily("09:00"),
      rules: {},
    });
    expect(created.status).toBe(201);
    const automation = core.store.automations.get(created.json.id);
    if (automation === undefined) throw new Error("It was saved.");
    // As the runner writes it, then the core goes down before the queue starts it.
    const slot = at("2026-11-23T09:00:00Z");
    const run = core.store.automations.addRun({
      automationId: automation.id,
      scheduledFor: slot,
      by: "schedule",
      depth: 0,
      status: "waiting",
      waitUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(run).toMatchObject({ number: 1, status: "waiting" });
    await core.close();

    core = await startCore(join(directory, "data"));
    await eventually(() => core.sessions.length > 0);
    await settle();
    expect(core.sessions).toHaveLength(1);
    const started = core.store.automations.getRun(run?.id ?? "");
    expect(started).toMatchObject({ status: "working", taskId: expect.any(String) });
    expect(core.store.getTask(started?.taskId ?? "")?.origin).toMatchObject({
      kind: "automation",
      automationId: automation.id,
      run: 1,
      name: "Morning notes",
    });
    const brief = core.sessions[0]?.sent.find((command) => command.type === "prompt");
    expect(brief).toMatchObject({ text: expect.stringContaining("Write today's notes for ") });
    expect(brief).not.toMatchObject({ text: expect.stringContaining("{date}") });

    const fresh = core.store.automations.get(automation.id);
    if (fresh === undefined) throw new Error("It is still there.");
    expect(core.runner.fire(fresh, slot, "schedule", 0)).toBeUndefined();
    await core.close();
    core = await startCore(join(directory, "data"));
    await settle();
    expect(core.store.automations.runs(automation.id, {}).runs).toHaveLength(1);

    // Events: a burst is one run, a key seen before never runs again, and what arrives while a run
    // works waits for it to end.
    const watched = mkdtempSync(join(directory, "inbox-"));
    const onEvents = await core.call("POST", "/automations", {
      name: "Inbox",
      task: {
        ...automation.task,
        request: { ...automation.task.request, prompt: "File {event}." },
      },
      trigger: { kind: "event", source: { kind: "folder", path: watched } },
      rules: {},
    });
    expect(onEvents.status).toBe(201);
    const id = onEvents.json.id as string;
    const burst = ["a.txt", "b.txt", "c.txt"].map((name, index) => ({
      key: name,
      at: Date.now() + index,
      text: `A file: ${name}`,
    }));
    expect(core.store.automationEvents.take(id, burst)).toBe(3);
    core.runner.fireEvents(id);
    expect(core.store.automationEvents.take(id, burst)).toBe(0);
    await eventually(() => core.sessions.length > 1);
    await settle();
    const [first] = core.store.automations.runs(id, {}).runs;
    expect(first).toMatchObject({ by: "event", events: 3, status: "working" });
    const prompt = core.sessions.at(-1)?.sent.find((command) => command.type === "prompt");
    expect(prompt).toMatchObject({ text: expect.stringContaining("<<<what started this run") });
    expect(prompt).toMatchObject({ text: expect.stringContaining("A file: c.txt") });
    core.store.automationEvents.take(id, [{ key: "d.txt", at: Date.now(), text: "A file: d.txt" }]);
    core.runner.fireEvents(id);
    expect(core.store.automations.runs(id, {}).runs).toHaveLength(1);
    expect(core.store.automationEvents.pending(id)).toMatchObject({ count: 1 });
  });

  it("sends a run's result once to where it was picked, keeps notes, stays quiet with nothing new, and keeps Telegram one way", async () => {
    const fake = await startFakeServices();
    await core.close();
    core = await startCore(join(directory, "delivery"), { telegram: fake.url });
    try {
      const add = (name: string, kind: string, keys: Record<string, string>) =>
        core.call("POST", "/destinations", { name, settings: { kind }, keys });
      const telegram = (await add("Phone", "telegram", { token: "bot-key" })).json.id as string;
      const slack = (await add("Team", "slack", { url: `${fake.url}/slack` })).json.id as string;
      const gone = (await add("Old", "slack", { url: `${fake.url}/slack-gone` })).json.id as string;
      // Linked with the one-time code, from one chat and one person.
      const { code } = (await core.call("POST", `/destinations/${telegram}/link`)).json;
      fake.updates.push({
        message: {
          message_id: 1,
          chat: { id: 42, type: "private" },
          from: { id: 7 },
          text: `/start ${code}`,
        },
      });
      await eventually(() => core.store.destinations.get(telegram)?.link !== undefined);
      expect(core.store.destinations.get(telegram)?.link).toMatchObject({ chatId: 42, userId: 7 });

      const scratch = core.store.listWorkspaces().find((workspace) => workspace.kind === "scratch");
      const created = await core.call("POST", "/automations", {
        name: "Digest",
        task: {
          kind: "assistant",
          request: {
            prompt: "Report what is new.",
            agent: { settings: { harness: "claude", environment: { kind: "native" } } },
            autonomy: "full",
            workspaceId: scratch?.id,
          },
        },
        trigger: daily("09:00"),
        rules: { sendTo: [telegram, slack, gone] },
      });
      const id = created.json.id as string;
      const runNow = async () => {
        const before = core.sessions.length;
        await core.call("POST", `/automations/${id}/run`);
        await eventually(() => core.sessions.length > before);
        await settle();
        return core.sessions.at(-1);
      };

      // Run 1 keeps a note; its result goes out once, cleaned of a key, and a refused send is told
      // on the run without failing it.
      const first = await runNow();
      const brief = first?.sent.find((command) => command.type === "prompt");
      expect(brief).toMatchObject({ text: expect.stringContaining("You have kept no notes yet.") });
      await core.callTool(first, "keep_notes", { notes: "Reported: item A" });
      playTurn(first, "Item A is new. Key: sk-ant-abcdefghijklmnopqrstuvwxyz123");
      const [run1] = core.store.automations.runs(id, {}).runs;
      await eventually(
        () => core.store.automations.getRun(run1?.id ?? "")?.sendProblem !== undefined,
      );
      const result = fake.sentToTelegram().find((message) => message.text?.includes("Item A"));
      expect(result?.text).toContain("[hidden]");
      expect(result?.text).not.toContain("sk-ant-");
      expect(fake.received.filter(({ path }) => path === "/slack")).toHaveLength(1);
      expect(core.store.automations.getRun(run1?.id ?? "")).toMatchObject({
        status: "done",
        sendProblem: "Couldn't send to Slack: the webhook was turned off or removed.",
      });
      expect(core.store.destinations.get(gone)?.problem).toBeDefined();
      expect(
        core.store.destinations.queue(telegram, `result:${run1?.id}`, id, run1?.id, "{}"),
      ).toBe(false);

      // Run 2 reads its notes as data, finds nothing new and stays quiet.
      const sentBefore = fake.sentToTelegram().length;
      const second = await runNow();
      const notes = second?.sent.find((command) => command.type === "prompt");
      expect(notes).toMatchObject({ text: expect.stringContaining("<<<notes you kept") });
      expect(notes).toMatchObject({ text: expect.stringContaining("Reported: item A") });
      await core.callTool(second, "report_nothing_new", {});
      playTurn(second, "Nothing new.");
      await eventually(() => core.store.automations.runs(id, {}).runs[0]?.status === "done");
      await settle();
      expect(core.store.automations.runs(id, {}).runs[0]).toMatchObject({ quiet: true });
      expect(fake.sentToTelegram()).toHaveLength(sentBefore);
      expect(core.store.automations.lastFinishedTask(id)).toBe(run1?.taskId);

      // Run 3 asks: the question goes out as plain words, answered in Office Town, and once linked
      // the core reads nothing from Telegram, so a reply there is left alone.
      const third = await runNow();
      third?.emit({ type: "turn.started", payload: { turnId: "turn" } });
      await core.callTool(third, "ask_user", {
        question: "Which source?",
        options: ["Feed", "Site"],
      });
      await eventually(() =>
        fake.sentToTelegram().some((message) => message.text?.includes("Which source?")),
      );
      const asked = fake
        .sentToTelegram()
        .find((message) => message.text?.includes("Which source?"));
      expect(asked?.text).toContain("Answer it in Office Town.");
      expect(asked?.reply_markup).toBeUndefined();
      const sessions = core.sessions.length;
      fake.updates.push({
        message: {
          message_id: 3,
          chat: { id: 42, type: "private" },
          from: { id: 7 },
          text: "Feed",
          reply_to_message: { message_id: asked?.message_id },
        },
      });
      await settle();
      expect(fake.updates).toHaveLength(1);
      expect(core.store.listPendingRequests().requests).toHaveLength(1);
      expect(core.sessions).toHaveLength(sessions);
    } finally {
      await fake.close();
    }
  });
});
