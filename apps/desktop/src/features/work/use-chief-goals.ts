import type { TaskRecord } from "@office-town/contract";
import { useMemo } from "react";
import { useApp } from "../../store/app-store.ts";

function chiefGoals(tasks: Record<string, { task: TaskRecord }>, chiefId: string) {
  const goals = Object.values(tasks)
    .map((entry) => entry.task)
    .filter((task) => task.leadAgentId === chiefId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = goals.find((task) => task.state !== "queued" && task.state !== "ended");
  return {
    current: open ?? goals.find((task) => task.state === "ended"),
    queue: goals.filter((task) => task.state === "queued").reverse(),
  };
}

// The goal now, else the last, and the goals queued behind it, next first.
export function useChiefGoals(chiefId: string | undefined) {
  const tasks = useApp((state) => state.tasks);
  return useMemo(
    () => (chiefId === undefined ? { current: undefined, queue: [] } : chiefGoals(tasks, chiefId)),
    [tasks, chiefId],
  );
}
