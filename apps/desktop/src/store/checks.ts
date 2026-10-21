import type { CheckRecord, TaskRecord } from "@office-town/contract";
import { useEffect, useMemo } from "react";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";

export const OPEN_CHECK = new Set<CheckRecord["status"]>(["drafting", "approving", "running"]);

export function keepChecks(checks: readonly CheckRecord[]): void {
  useApp.setState((state) => ({
    checks: { ...state.checks, ...Object.fromEntries(checks.map((check) => [check.id, check])) },
  }));
}

// Read once the task is shown; later rounds come on the live stream.
export function useChecks(taskId: string): CheckRecord[] {
  const all = useApp((state) => state.checks);
  useEffect(() => {
    api
      .listChecks(taskId)
      .then(keepChecks)
      .catch(() => {
        // The card shows no check until the next read works.
      });
  }, [taskId]);
  return useMemo(
    () =>
      Object.values(all)
        .filter((check) => check.taskId === taskId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [all, taskId],
  );
}

// From round 2 on, the list the user approved, unless the lead wrote a newer checklist (D-73).
export function approvedList(
  checks: readonly CheckRecord[],
  task: TaskRecord | undefined,
): CheckRecord | undefined {
  const last = checks.findLast((check) => check.items.length > 0);
  const written = task?.checklist?.writtenAt;
  if (last === undefined || (written !== undefined && written > last.createdAt)) return undefined;
  return last;
}
