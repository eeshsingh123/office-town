import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { buildItems, type Item } from "./task-list.ts";

export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// The loaded tasks as Tasks rows, each with the one status every screen shows.
export function useTaskItems(now: number): Item[] {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const pieces = useApp((state) => state.pieces);
  const waiting = useApp((state) => state.waiting);
  const traces = useApp((state) => state.traces);
  const chiefId = useApp((state) => state.chiefId);
  return useMemo(
    () =>
      buildItems({ tasks, sessions, agents, departments, pieces, waiting, traces, chiefId }, now),
    [tasks, sessions, agents, departments, pieces, waiting, traces, chiefId, now],
  );
}
