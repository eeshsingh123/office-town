import type { AgentSettings } from "@office-town/contract";
import { accountTitle, chooseAccount, sessionAccountId } from "../accounts/accounts.ts";
import type { Store } from "../store/store.ts";
import { topSession } from "../team/task-state.ts";
import { busyName, isClaimed } from "../team/team-tasks.ts";
import { PAUSE_AT } from "../team/usage-pause.ts";

export interface Wait {
  // "Waiting: Content team is busy".
  reason: string;
  // Once it waited too long: "Content team was busy for 12 hours, so it was not resumed."
  gaveUp: string;
}

// What a start needs free: its department or the chief, and room on its account.
export interface Claimant {
  departmentId?: string | undefined;
  chief?: boolean;
  accountId?: string | undefined;
  // "resumed" or "run", for the reason given up.
  verb: string;
  // When it was asked for: per department, the oldest goes first (D-125).
  since: number;
}

const clock = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const hoursText = (hours: number) => (hours === 1 ? "an hour" : `${hours} hours`);

function fullAccount(store: Store, claimant: Claimant, hours: number): Wait | undefined {
  const { accountId } = claimant;
  if (accountId === undefined) return undefined;
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
    gaveUp: `${name} stayed near its limit for ${hoursText(hours)}, so it was not ${claimant.verb}.`,
  };
}

// A part of the chief's plan asked for this department before this start was.
function earlierPiece(store: Store, claimant: Claimant): boolean {
  const { departmentId } = claimant;
  if (departmentId === undefined) return false;
  return store.listOpenPieces().some(({ id }) => {
    const piece = store.getPiece(id);
    return (
      piece?.status === "queued" &&
      piece.departmentId === departmentId &&
      Date.parse(piece.createdAt) < claimant.since
    );
  });
}

// An automation's run waiting for this department since before `since`, with room on its account:
// a part of the chief's plan gives way to it, as the run gives way to an earlier part (D-125).
export function earlierRun(store: Store, departmentId: string, since: number): boolean {
  const department = store.getDepartment(departmentId);
  if (department === undefined) return false;
  const accountId = accountOf(store, store.getAgent(department.leadAgentId)?.settings);
  return store.queue.waiting().some((entry) => {
    if (entry.what.kind !== "run") return false;
    const run = store.automations.getRun(entry.what.runId);
    const task = run === undefined ? undefined : store.automations.get(run.automationId)?.task;
    return (
      run !== undefined &&
      task?.kind === "department" &&
      task.request.team.departmentId === departmentId &&
      Date.parse(run.createdAt) < since &&
      fullAccount(store, { accountId, verb: "run", since }, 0) === undefined
    );
  });
}

function chiefBusy(store: Store): boolean {
  const chiefId = store.readSettings().chiefAgentId;
  if (chiefId === undefined) return false;
  return (
    store.openTaskOfLead(chiefId) !== undefined ||
    isClaimed(chiefId) ||
    store.oldestQueuedTask() !== undefined
  );
}

// Why a start cannot happen now, in the words a person's own start would use, or undefined when
// it can: its department and the chief free, then room on its account (D-121).
export function waitOn(
  store: Store,
  claimant: Claimant,
  taskId: string | undefined,
  hours: number,
): Wait | undefined {
  const busy =
    claimant.chief === true && chiefBusy(store)
      ? "The chief"
      : busyName(store, claimant.departmentId, taskId);
  if (busy !== undefined) {
    return {
      reason: `Waiting: ${busy} is busy`,
      gaveUp: `${busy} was busy for ${hoursText(hours)}, so it was not ${claimant.verb}.`,
    };
  }
  if (earlierPiece(store, claimant)) {
    const name = store.getDepartment(claimant.departmentId ?? "")?.name ?? "The department";
    return {
      reason: `Waiting: ${name} has an earlier part of the chief's plan`,
      gaveUp: `${name} was busy for ${hoursText(hours)}, so it was not ${claimant.verb}.`,
    };
  }
  return fullAccount(store, claimant, hours);
}

// The account a new agent on these settings would run on.
export const accountOf = (store: Store, settings: AgentSettings | undefined) =>
  settings === undefined ? undefined : chooseAccount(store, settings).accountId;

// A task to resume: the account its top agent ran on.
export function waitFor(store: Store, taskId: string, hours: number): Wait | undefined {
  const task = store.getTask(taskId);
  if (task === undefined) return undefined;
  const top = topSession(task, store.listSessions(taskId));
  return waitOn(
    store,
    {
      departmentId: task.departmentId,
      accountId: top === undefined ? undefined : sessionAccountId(top.options),
      verb: "resumed",
      since: Date.parse(task.createdAt),
    },
    taskId,
    hours,
  );
}
