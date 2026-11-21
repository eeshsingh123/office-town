import { accountTitle, sessionAccountId } from "../accounts/accounts.ts";
import type { Store } from "../store/store.ts";
import { topSession } from "../team/task-state.ts";
import { busyName } from "../team/team-tasks.ts";
import { PAUSE_AT } from "../team/usage-pause.ts";

export interface Wait {
  // "Waiting: Content team is busy".
  reason: string;
  // Once it waited too long: "Content team was busy for 12 hours, so it was not resumed."
  gaveUp: string;
}

const clock = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// The account its top agent runs on, when it is past 95% of a window that has not reset (D-72).
function fullAccount(store: Store, taskId: string, hours: number): Wait | undefined {
  const task = store.getTask(taskId);
  const top = task === undefined ? undefined : topSession(task, store.listSessions(taskId));
  if (top === undefined) return undefined;
  const accountId = sessionAccountId(top.options);
  const now = Date.now();
  const full = store
    .listLimits()
    .find((limits) => limits.accountId === accountId)
    ?.limits.filter((limit) => limit.resetsAt === undefined || Date.parse(limit.resetsAt) > now)
    .filter((limit) => limit.usedFraction >= PAUSE_AT)
    .toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
  if (full === undefined) return undefined;
  const name = accountTitle(store, accountId);
  const until = full.resetsAt === undefined ? "" : ` until ${clock(full.resetsAt)}`;
  return {
    reason: `Waiting: ${name} is at ${Math.round(full.usedFraction * 100)}%${until}`,
    gaveUp: `${name} stayed near its limit for ${hours} hours, so it was not resumed.`,
  };
}

// Why a task cannot start now, in the words a person's own start would use, or undefined when it
// can: its department and the chief free, then room on its account (D-121).
export function waitFor(store: Store, taskId: string, hours: number): Wait | undefined {
  const task = store.getTask(taskId);
  if (task === undefined) return undefined;
  const busy = busyName(store, task.departmentId, taskId);
  if (busy !== undefined) {
    return {
      reason: `Waiting: ${busy} is busy`,
      gaveUp: `${busy} was busy for ${hours} hours, so it was not resumed.`,
    };
  }
  return fullAccount(store, taskId, hours);
}
