import type { TaskSearch, TaskTab } from "@office-town/contract";
import { useEffect, useRef, useState } from "react";
import { searchTasks } from "../../store/live.ts";
import type { Filters, Started } from "./task-list.ts";

const PAGE = 50;
// The most the core sends at once; reading a list again keeps this many of it.
const MOST = 200;
const TYPING_MS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// What the core found among tasks the app does not follow live.
export interface Found {
  ids: ReadonlySet<string>;
  next: string | undefined;
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
 * Search, filters and counts cover every task the core holds, not only those loaded. `changed`
 * moves whenever a task the core counts may have changed, so the list is read again.
 */
export function useTaskSearch(filters: Filters, changed: string, now: number) {
  const text = useTyped(filters.query);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const search: Partial<TaskSearch> = {
    text,
    tab: filters.tab,
    teams: filters.teams,
    ...(filters.workspaceId === undefined ? {} : { workspaceId: filters.workspaceId }),
    ...startedRange(filters.started, midnight),
  };
  const key = JSON.stringify(search);
  const [found, setFound] = useState(last?.key === key ? last.found : undefined);
  const shown = useRef({ key, count: 0 });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `search`.
  useEffect(() => {
    let current = true;
    const again = shown.current.key === key;
    const limit = again ? Math.min(MOST, Math.max(PAGE, shown.current.count)) : PAGE;
    searchTasks({ ...search, limit })
      .then((result) => {
        if (!current) return;
        const next: Found = {
          ids: new Set(result.tasks.map((task) => task.id)),
          next: result.next,
          counts: result.counts,
          teams: new Set(result.teams),
          workspaceIds: new Set(result.workspaceIds),
        };
        shown.current = { key, count: result.tasks.length };
        last = { key, found: next };
        setFound(next);
      })
      .catch((error: unknown) => console.error("Could not search tasks.", error));
    return () => {
      current = false;
    };
  }, [key, changed]);

  const showOlder = async () => {
    if (found?.next === undefined) return;
    const result = await searchTasks({ ...search, limit: PAGE, cursor: found.next });
    const next: Found = {
      ...found,
      ids: new Set([...found.ids, ...result.tasks.map((task) => task.id)]),
      next: result.next,
      counts: result.counts,
    };
    shown.current = { key, count: next.ids.size };
    last = { key, found: next };
    setFound(next);
  };

  return { found, showOlder };
}
