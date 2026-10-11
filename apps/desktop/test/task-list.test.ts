import type { AgentRecord, PlanPiece, SessionRecord, TaskRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import {
  buildItems,
  groupRows,
  type Item,
  NO_FILTERS,
  STUCK_AFTER_MS,
  tabCounts,
} from "../src/features/tasks/task-list.ts";
import type { WaitingRequest } from "../src/store/records.ts";
import { emptyTrace, type Trace } from "../src/trace/trace.ts";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const task = (id: string, fields: Partial<TaskRecord>): TaskRecord => ({
  id,
  prompt: id,
  createdAt: at(120),
  state: "working",
  usage: [],
  ...fields,
});
const session = (id: string, taskId: string, agentId: string): SessionRecord =>
  ({ id, taskId, agentId, status: "running", createdAt: at(120) }) as SessionRecord;
const agent = (id: string): AgentRecord => ({ id, name: id, colour: "#3A6EA5" }) as AgentRecord;
const piece = (id: string, fields: Partial<PlanPiece>): PlanPiece => ({
  id,
  taskId: "launch",
  key: id,
  title: id,
  brief: id,
  waitsOn: [],
  status: "working",
  createdAt: at(100),
  ...fields,
});

function known(traces: Record<string, Trace> = {}) {
  const records = [
    task("launch", { leadAgentId: "chief", state: "idle" }),
    task("build", { parentTaskId: "launch", departmentId: "web", state: "waiting" }),
    task("notes", { state: "working" }),
  ];
  const ask = {
    position: 1,
    event: {
      sessionId: "s-build",
      type: "permission.requested",
      payload: { title: "Run pnpm install" },
    },
  } as unknown as WaitingRequest;
  return {
    tasks: Object.fromEntries(
      records.map((record) => [record.id, { task: record, sessionIds: [`s-${record.id}`] }]),
    ),
    sessions: {
      "s-launch": session("s-launch", "launch", "chief"),
      "s-build": session("s-build", "build", "rui"),
      "s-notes": session("s-notes", "notes", "solo"),
    },
    agents: { chief: agent("chief"), rui: agent("rui"), solo: agent("solo") },
    departments: {},
    pieces: {
      build: piece("build", { pieceTaskId: "build", departmentId: "web" }),
      test: piece("test", { status: "waiting", waitsOn: ["build"], departmentId: "web" }),
    },
    waiting: { "s-build/r1": ask },
    traces,
    chiefId: "chief",
  };
}

const haystack = (item: Item) => item.title;
const ORDER = ["chief", "web", "solo"];

describe("task list", () => {
  it("puts a chief's parts under the goal, and alone under their team when the goal is filtered out", () => {
    const items = buildItems(known(), NOW);
    const goal = items.find((item) => item.id === "launch");
    expect(goal?.status).toBe("needs");
    expect(goal?.answerTaskId).toBe("build");
    expect(goal?.parts.map((part) => part.id)).toEqual(["build", "test"]);
    expect(goal?.parts[1]?.line?.text).toBe("Starts after build");

    const byTeam = groupRows(items, NO_FILTERS, "team", haystack, ORDER, NOW);
    expect(byTeam.map((group) => [group.key, group.rows.map((row) => row.item.id)])).toEqual([
      ["chief", ["launch"]],
      ["solo", ["notes"]],
    ]);

    const web = groupRows(items, { ...NO_FILTERS, teams: ["web"] }, "team", haystack, ORDER, NOW);
    expect(web).toEqual([
      {
        key: "web",
        rows: [{ item: expect.objectContaining({ id: "build" }), parts: [], goalTitle: "Launch" }],
      },
    ]);
  });

  it("lists a group task with its lead's department", () => {
    const state = known();
    state.departments = { web: { id: "web" } } as unknown as typeof state.departments;
    state.agents.rui = { ...agent("rui"), departmentId: "web" };
    state.tasks.group = {
      task: task("group", { leadAgentId: "rui", workerAgentIds: ["solo"] }),
      sessionIds: [],
    };
    const group = buildItems(state, NOW).find((item) => item.id === "group");
    expect(group?.team).toBe("web");
  });

  it("counts a goal that needs you through a part once, by the part", () => {
    const counts = tabCounts(buildItems(known(), NOW), NO_FILTERS, haystack, NOW);
    expect(counts.needs).toBe(1);
  });

  it("calls a working task stuck only after an hour with nothing new in its trace", () => {
    const trace = (minutesAgo: number): Trace => ({
      ...emptyTrace("s-notes"),
      turnOpen: true,
      items: new Map([
        [
          "a1",
          {
            kind: "action",
            id: "a1",
            actionKind: "other",
            title: "Reading files",
            input: {},
            status: "completed",
            startedAt: at(minutesAgo),
            children: [],
            requestIds: [],
          },
        ],
      ]),
    });
    const stuck = (traces: Record<string, Trace>) =>
      buildItems(known(traces), NOW).find((item) => item.id === "notes")?.stuck;

    expect(stuck({})).toBe(false);
    expect(stuck({ "s-notes": trace(STUCK_AFTER_MS / 60_000 - 1) })).toBe(false);
    expect(stuck({ "s-notes": trace(STUCK_AFTER_MS / 60_000 + 1) })).toBe(true);
  });
});
