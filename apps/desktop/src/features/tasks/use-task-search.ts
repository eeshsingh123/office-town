import type { TaskSearch, TaskSearchResult, TaskTab } from "@office-town/contract";
import { useEffect, useRef, useState } from "react";
import { searchTasks } from "../../store/live.ts";
import type { TaskEntry } from "../../store/records.ts";
import type { Filters, Started } from "./task-list.ts";

const PAGE = 50;
// The most the core sends at once.
const MOST = 200;
const TYPING_MS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// What the core found among tasks the app does not follow live.
export interface Found {
  // When older matches wait behind "Show older tasks", when the oldest shown one started.
  oldest: string | undefined;
  next: string | undefined;
  shown: number;
  counts: Record<TaskTab, number>;
  teams: ReadonlySet<string>;
  workspaceIds: ReadonlySet<string>;
}

// Back shows the last list at once while it is read again.
let last: { key: string; found: Found } | undefined;

function startedRange(started: Started, midnight: number): Pick<TaskSearch, "from" | "before"> {
  const weekStart = new Date(midnight - 6 * DAY_MS).toISOString();
  switch (started) {
    case "any":
      return {};
    case "today":
      return { from: new Date(midnight).toISOString() };
    case "week":
      return { from: weekStart };
    case "older":
      return { before: weekStart };
  }
}

function useTyped(text: string): string {
  const [typed, setTyped] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setTyped(text), TYPING_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return typed;
}

/**
 * Counts what may change the core's answer: a held task's status fields, one going live or quiet,
 * one deleted, or a new one. Older tasks only added to the app, as a search does, change nothing.
 */
export function useTaskMoves(tasks: Record<string, TaskEntry>, live: ReadonlySet<string>): number {
  const before = useRef<Map<string, string>>(undefined);
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    const now = new Map(
      Object.values(tasks).map(({ task }) => [
        task.id,
        live.has(task.id) ? "live" : `${task.state}:${task.reviewedAt}:${task.title}`,
      ]),
    );
    const known = before.current;
    before.current = now;
    if (known === undefined) return;
    const newest = Object.values(tasks).reduce(
      (latest, { task }) =>
        known.has(task.id) && task.createdAt > latest ? task.createdAt : latest,
      "",
    );
    const moved =
      [...known].some(([id, signature]) => now.get(id) !== signature) ||
      Object.values(tasks).some(({ task }) => !known.has(task.id) && task.createdAt > newest);
    if (moved) setMoves((count) => count + 1);
  }, [tasks, live]);
  return moves;
}

// Reads from the newest down to `count` matches, a page at a time.
async function readDown(search: Partial<TaskSearch>, count: number): Promise<TaskSearchResult> {
  let result = await searchTasks({ ...search, limit: Math.min(MOST, count) });
  let { tasks } = result;
  while (tasks.length < count && result.next !== undefined) {
    const limit = Math.min(MOST, count - tasks.length);
    result = await searchTasks({ ...search, limit, cursor: result.next });
    tasks = [...tasks, ...result.tasks];
  }
  return { ...result, tasks };
}

function toFound(result: TaskSearchResult, shown: number, oldest: string | undefined): Found {
  return {
    oldest: result.next === undefined ? undefined : oldest,
    next: result.next,
    shown,
    counts: result.counts,
    teams: new Set(result.teams),
    workspaceIds: new Set(result.workspaceIds),
  };
}

/**
 * Search, filters and counts cover every task the core holds, not only those loaded. `teams` are
 * the names the page shows for each team, so typing "Assistants" finds their older tasks too.
 */
export function useTaskSearch(
  filters: Filters,
  teams: readonly { key: string; name: string }[],
  moves: number,
  now: number,
) {
  const text = useTyped(filters.query);
  const needle = text.trim().toLowerCase();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const search: Partial<TaskSearch> = {
    text,
    textTeams:
      needle === ""
        ? []
        : teams.filter((team) => team.name.toLowerCase().includes(needle)).map(({ key }) => key),
    tab: filters.tab,
    teams: filters.teams,
    ...(filters.workspaceId === undefined ? {} : { workspaceId: filters.workspaceId }),
    ...startedRange(filters.started, midnight),
  };
  const key = JSON.stringify(search);
  const [found, setFound] = useState(last?.key === key ? last.found : undefined);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const current = useRef({ key, shown: last?.key === key ? last.found.shown : 0 });
  // A page that arrives after the filters changed belongs to the old list.
  const latest = useRef(key);
  latest.current = key;

  const keep = (next: Found) => {
    current.current = { key, shown: next.shown };
    last = { key, found: next };
    setFound(next);
    setFailed(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `search`.
  useEffect(() => {
    let live = true;
    // Read again for the same search, it keeps every task already shown.
    const count = current.current.key === key ? Math.max(PAGE, current.current.shown) : PAGE;
    readDown(search, count)
      .then((result) => {
        if (live) keep(toFound(result, result.tasks.length, result.tasks.at(-1)?.createdAt));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [key, moves, tries]);

  const showOlder = async () => {
    if (found?.next === undefined) return;
    try {
      const result = await searchTasks({ ...search, limit: PAGE, cursor: found.next });
      if (latest.current !== key) return;
      const oldest = result.tasks.at(-1)?.createdAt ?? found.oldest;
      keep(toFound(result, found.shown + result.tasks.length, oldest));
    } catch {
      setFailed(true);
    }
  };

  return { found, failed, retry: () => setTries((count) => count + 1), showOlder };
}
