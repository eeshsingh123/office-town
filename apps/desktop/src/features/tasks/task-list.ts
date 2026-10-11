import type { PlanPiece, TaskRecord } from "@office-town/contract";
import { type Agent, agentsInTask, taskStateOf } from "../../store/agents.ts";
import type { AppState } from "../../store/app-store.ts";
import { progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { taskTitle } from "../../ui/format.ts";
import { requestSummary } from "../requests/summary.ts";

export type RowStatus = "needs" | "working" | "queued" | "review" | "done" | "failed" | "stopped";
export type Tab = "all" | "needs" | "active" | "review" | "done" | "ended";
export type GroupBy = "team" | "status" | "day";
export type Started = "any" | "today" | "week" | "older";
// "chief", "solo" or a department id.
export type TeamKey = string;

export const STATUS_ORDER: RowStatus[] = [
  "needs",
  "working",
  "queued",
  "review",
  "failed",
  "stopped",
  "done",
];

export const STATUS_LABELS: Record<RowStatus, string> = {
  needs: "Needs you",
  working: "Working",
  queued: "Waiting",
  review: "To review",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const TAB_STATUSES: Record<Exclude<Tab, "all">, RowStatus[]> = {
  needs: ["needs"],
  active: ["working", "queued"],
  review: ["review"],
  done: ["done"],
  ended: ["failed", "stopped"],
};

// Working with no new step, action or message for this long is flagged as stuck (owner, 2026-10-11).
export const STUCK_AFTER_MS = 60 * 60 * 1000;

export interface Line {
  text: string;
  tone: "quiet" | "ask" | "error";
}

export interface Item {
  // A task id, or a piece id for a piece not started yet.
  id: string;
  task: TaskRecord | undefined;
  title: string;
  status: RowStatus;
  team: TeamKey;
  agents: Agent[];
  line: Line | undefined;
  progress: { done: number; total: number; unit: "steps" | "parts" } | undefined;
  createdAt: string;
  activityAt: string;
  stuck: boolean;
  workspaceId: string | undefined;
  // The chief's goal this is a part of.
  goalId: string | undefined;
  // Parts of a chief's goal, in plan order.
  parts: Item[];
  // Where the user answers, when a part asks rather than the goal.
  answerTaskId: string | undefined;
}

type Known = Pick<
  AppState,
  "tasks" | "sessions" | "agents" | "departments" | "pieces" | "waiting" | "traces" | "chiefId"
>;

const OPEN_PIECE = new Set<PlanPiece["status"]>(["waiting", "queued", "working"]);
const activityCache = new WeakMap<Trace, string>();

// The newest moment anything happened in a trace.
function lastActivity(trace: Trace): string {
  const cached = activityCache.get(trace);
  if (cached !== undefined) return cached;
  let latest = "";
  for (const item of trace.items.values()) {
    const at =
      item.kind === "action"
        ? (item.endedAt ?? item.startedAt)
        : item.kind === "message"
          ? item.at
          : "";
    if (at > latest) latest = at;
  }
  activityCache.set(trace, latest);
  return latest;
}

// A group task sits with its lead's department (D-63).
export function teamOf(
  task: TaskRecord,
  known: Pick<Known, "chiefId" | "agents" | "departments">,
): TeamKey {
  const { chiefId } = known;
  if (task.parentTaskId === undefined && chiefId !== undefined && task.leadAgentId === chiefId) {
    return "chief";
  }
  if (task.workerAgentIds !== undefined) {
    const departmentId = known.agents[task.leadAgentId ?? ""]?.departmentId;
    return departmentId !== undefined && known.departments[departmentId] !== undefined
      ? departmentId
      : "solo";
  }
  return task.departmentId ?? "solo";
}

function statusOf(task: TaskRecord, agents: Agent[], known: Known, waiting: Set<string>) {
  const agentState = taskStateOf(agents, known.traces, waiting);
  const openPieces = Object.values(known.pieces).some(
    (piece) => piece.taskId === task.id && OPEN_PIECE.has(piece.status),
  );
  switch (task.state) {
    case "waiting":
      return "needs";
    case "working":
      return "working";
    case "queued":
      return "queued";
    case "idle":
      if (openPieces) return "working";
      return agentState === "interrupted" ? "stopped" : "done";
    case "ended":
      if (agentState === "failed") return "failed";
      if (agentState === "stopped" || agentState === "interrupted") return "stopped";
      // A part reports to the chief, so only the whole goal waits for review.
      return task.reviewedAt === undefined && task.parentTaskId === undefined ? "review" : "done";
  }
}

// The step the busiest agent is on, else what it is doing right now.
function workLine(agents: Agent[], known: Known): Line | undefined {
  for (const agent of agents) {
    const trace = known.traces[agent.latest.id];
    if (trace === undefined) continue;
    const progress = progressOf(trace);
    if (progress.step !== undefined) {
      const text = `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
      return { text, tone: "quiet" };
    }
    if (progress.current !== undefined) return { text: progress.current.title, tone: "quiet" };
  }
  return undefined;
}

function stepsOf(agents: Agent[], known: Known): Item["progress"] {
  const lead = agents[0];
  const trace = lead === undefined ? undefined : known.traces[lead.latest.id];
  if (trace === undefined || trace.plan.length === 0) return undefined;
  const progress = progressOf(trace);
  return { done: progress.stepsDone, total: progress.stepCount, unit: "steps" };
}

function askLine(agents: Agent[], known: Known): Line | undefined {
  const sessions = new Set(agents.map((agent) => agent.latest.id));
  const ask = Object.values(known.waiting).find(({ event }) => sessions.has(event.sessionId));
  return ask === undefined ? undefined : { text: requestSummary(ask.event), tone: "ask" };
}

function departmentName(known: Known, id: string | undefined): string {
  return id === undefined ? "Its department" : (known.departments[id]?.name ?? "Its department");
}

function taskItem(task: TaskRecord, known: Known, waiting: Set<string>, now: number): Item {
  const agents = agentsInTask(known, task.id);
  const status = statusOf(task, agents, known, waiting);
  const sessions = (known.tasks[task.id]?.sessionIds ?? []).flatMap(
    (id) => known.sessions[id] ?? [],
  );
  const traced = sessions.flatMap((session) => {
    const trace = known.traces[session.id];
    return trace === undefined ? [] : [lastActivity(trace)];
  });
  const times = [task.createdAt, ...traced];
  for (const session of sessions) times.push(session.endedAt ?? session.createdAt);
  const activityAt = times.reduce((latest, at) => (at > latest ? at : latest));
  const interrupted = agents[0]?.latest.status === "interrupted";

  let line: Line | undefined;
  if (status === "needs") line = askLine(agents, known);
  else if (status === "working") line = workLine(agents, known);
  else if (status === "queued") {
    line = {
      text: `Waiting for ${departmentName(known, task.departmentId)} to be free`,
      tone: "quiet",
    };
  } else if (status === "stopped" && interrupted) {
    line = { text: "Stopped when the app closed", tone: "quiet" };
  }

  return {
    id: task.id,
    task,
    title: taskTitle(task.prompt),
    status,
    team: teamOf(task, known),
    agents,
    line,
    progress: status === "working" || status === "needs" ? stepsOf(agents, known) : undefined,
    createdAt: task.createdAt,
    activityAt,
    // Without a trace nothing is known about its activity, so it is never called stuck.
    stuck:
      status === "working" && traced.length > 0 && now - Date.parse(activityAt) > STUCK_AFTER_MS,
    workspaceId: task.workspaceId,
    goalId: task.parentTaskId,
    parts: [],
    answerTaskId: status === "needs" ? task.id : undefined,
  };
}

// A planned part that has no task yet.
function pieceItem(piece: PlanPiece, known: Known, goal: TaskRecord): Item {
  const before = piece.waitsOn.flatMap((id) => {
    const upstream = known.pieces[id];
    return upstream === undefined || upstream.status === "done" ? [] : [upstream.title];
  });
  const text =
    piece.status === "queued"
      ? `Waiting for ${departmentName(known, piece.departmentId)} to be free`
      : before.length > 0
        ? `Starts after ${before.join(", ")}`
        : "Not started";
  return {
    id: piece.id,
    task: undefined,
    title: piece.title,
    status: "queued",
    team: piece.departmentId ?? "solo",
    agents: [],
    line: { text, tone: "quiet" },
    progress: undefined,
    createdAt: piece.createdAt,
    activityAt: piece.createdAt,
    stuck: false,
    workspaceId: undefined,
    goalId: goal.id,
    parts: [],
    answerTaskId: undefined,
  };
}

// Every loaded task as a row; a chief's goal carries its parts, planned ones included.
export function buildItems(known: Known, now: number): Item[] {
  const waiting = new Set(Object.values(known.waiting).map(({ event }) => event.sessionId));
  const items = new Map<string, Item>();
  for (const { task } of Object.values(known.tasks)) {
    items.set(task.id, taskItem(task, known, waiting, now));
  }
  for (const goal of items.values()) {
    if (goal.task === undefined) continue;
    const pieces = Object.values(known.pieces)
      .filter((piece) => piece.taskId === goal.id && piece.status !== "dropped")
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (pieces.length === 0) continue;
    goal.parts = pieces.map((piece) => {
      const part = piece.pieceTaskId === undefined ? undefined : items.get(piece.pieceTaskId);
      return part ?? pieceItem(piece, known, goal.task as TaskRecord);
    });
    const done = pieces.filter((piece) => piece.status === "done").length;
    goal.progress = { done, total: pieces.length, unit: "parts" };
    const asking = goal.parts.find((part) => part.status === "needs");
    if (goal.status !== "needs" && asking !== undefined) {
      goal.status = "needs";
      goal.answerTaskId = asking.id;
      const team = departmentName(known, asking.team);
      goal.line = { text: `${team}: ${asking.line?.text ?? "Needs you"}`, tone: "ask" };
    } else if (goal.status === "working" && goal.line === undefined) {
      const working = goal.parts.filter((part) => part.status === "working");
      const first = working[0];
      if (first !== undefined) {
        const more = working.length > 1 ? ` and ${working.length - 1} more` : "";
        const text = `${departmentName(known, first.team)}: ${first.title}${more}`;
        goal.line = { text, tone: "quiet" };
      }
    }
  }
  return [...items.values()];
}

export interface Filters {
  tab: Tab;
  query: string;
  teams: TeamKey[];
  workspaceId: string | undefined;
  started: Started;
}

export const NO_FILTERS: Filters = {
  tab: "all",
  query: "",
  teams: [],
  workspaceId: undefined,
  started: "any",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startedMatches(createdAt: string, started: Started, now: number): boolean {
  if (started === "any") return true;
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const at = Date.parse(createdAt);
  if (started === "today") return at >= midnight;
  if (started === "week") return at >= midnight - 6 * DAY_MS;
  return at < midnight - 6 * DAY_MS;
}

// Everything but the tab, so each tab can show how many it would hold.
function narrowed(item: Item, filters: Filters, haystack: (item: Item) => string, now: number) {
  if (filters.teams.length > 0 && !filters.teams.includes(item.team)) return false;
  if (filters.workspaceId !== undefined && item.workspaceId !== filters.workspaceId) return false;
  if (!startedMatches(item.createdAt, filters.started, now)) return false;
  const query = filters.query.trim().toLowerCase();
  return query === "" || haystack(item).toLowerCase().includes(query);
}

function onTab(item: Item, tab: Tab): boolean {
  return tab === "all" || TAB_STATUSES[tab].includes(item.status);
}

export function tabCounts(
  items: Item[],
  filters: Filters,
  haystack: (item: Item) => string,
  now: number,
): Record<Tab, number> {
  const counts: Record<Tab, number> = { all: 0, needs: 0, active: 0, review: 0, done: 0, ended: 0 };
  for (const item of items) {
    if (!narrowed(item, filters, haystack, now)) continue;
    counts.all += 1;
    for (const tab of Object.keys(TAB_STATUSES) as Exclude<Tab, "all">[]) {
      // A goal that needs you only through a part is counted once, by that part.
      if (tab === "needs" && item.parts.some((part) => part.status === "needs")) continue;
      if (onTab(item, tab)) counts[tab] += 1;
    }
  }
  return counts;
}

export interface Row {
  item: Item;
  // Shown under the row, only for a goal.
  parts: Item[];
  // Set when a part is shown apart from its goal.
  goalTitle: string | undefined;
}

export interface Group {
  key: string;
  rows: Row[];
}

function sortRows(rows: Row[]): Row[] {
  return rows.toSorted(
    (a, b) =>
      STATUS_ORDER.indexOf(a.item.status) - STATUS_ORDER.indexOf(b.item.status) ||
      b.item.createdAt.localeCompare(a.item.createdAt),
  );
}

function dayKey(iso: string, now: number): string {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const at = Date.parse(iso);
  if (at >= midnight) return "today";
  if (at >= midnight - DAY_MS) return "yesterday";
  if (at >= midnight - 6 * DAY_MS) return "week";
  return "older";
}

export const DAY_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
  older: "Older",
};

/**
 * By team, a part sits under its chief's goal; it stands alone, named by its goal, only when its
 * goal is filtered out. By status or day, every task is its own row.
 */
export function groupRows(
  items: Item[],
  filters: Filters,
  by: GroupBy,
  haystack: (item: Item) => string,
  teamOrder: TeamKey[],
  now: number,
): Group[] {
  const matches = (item: Item) =>
    item.task !== undefined && onTab(item, filters.tab) && narrowed(item, filters, haystack, now);
  const tasks = items.filter((item) => item.task !== undefined);
  const titles = new Map(tasks.map((item) => [item.id, item.title]));
  const groups = new Map<string, Row[]>();
  const add = (key: string, row: Row) => groups.set(key, [...(groups.get(key) ?? []), row]);

  if (by === "team") {
    const shownGoals = new Set<string>();
    for (const item of tasks) {
      if (item.goalId !== undefined) continue;
      const own = matches(item);
      const partMatches = item.parts.filter(
        (part) =>
          (part.task === undefined ? onTab(part, filters.tab) : matches(part)) &&
          narrowed(part, filters, haystack, now),
      );
      const viaParts = filters.teams.length === 0 && partMatches.length > 0;
      if (!own && !viaParts) continue;
      shownGoals.add(item.id);
      add(item.team, { item, parts: own ? item.parts : partMatches, goalTitle: undefined });
    }
    for (const item of tasks) {
      if (item.goalId === undefined || shownGoals.has(item.goalId) || !matches(item)) continue;
      add(item.team, { item, parts: [], goalTitle: titles.get(item.goalId) });
    }
    return teamOrder.flatMap((key) => {
      const rows = groups.get(key);
      return rows === undefined ? [] : [{ key, rows: sortRows(rows) }];
    });
  }

  for (const item of tasks) {
    if (!matches(item)) continue;
    const goalTitle = item.goalId === undefined ? undefined : titles.get(item.goalId);
    add(by === "status" ? item.status : dayKey(item.createdAt, now), {
      item,
      parts: [],
      goalTitle,
    });
  }
  const order = by === "status" ? STATUS_ORDER : Object.keys(DAY_LABELS);
  return order.flatMap((key) => {
    const rows = groups.get(key);
    return rows === undefined ? [] : [{ key, rows: sortRows(rows) }];
  });
}
