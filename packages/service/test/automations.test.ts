import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Trigger } from "@office-town/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catchUp, missedSince, nextRuns } from "../src/automations/clock.ts";
import { type Core, eventually, settle, startCore } from "./support/team-core.ts";

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
  it("writes a run under its key before it starts, and after a restart starts it once and never fires that slot again", async () => {
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
  });
});
