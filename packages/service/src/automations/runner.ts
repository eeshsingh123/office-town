import {
  type AutomationRecord,
  type AutomationRun,
  CHAIN_DEPTH,
  type Change,
  type RunStatus,
  type TaskRecord,
  taskStatus,
} from "@office-town/contract";
import { isChiefTask } from "../chief/chief.ts";
import { stopChiefGoal } from "../chief/goals.ts";
import type { NameTask } from "../drafts/title.ts";
import type { Notifier } from "../notify/notifier.ts";
import { type Wait, waitOn } from "../queue/admission.ts";
import type { AdmissionQueue } from "../queue/admission-queue.ts";
import type { TeamContext } from "../team/members.ts";
import { topSession } from "../team/task-state.ts";
import { markDone, stopTeam } from "../team/team-tasks.ts";
import { Clock, catchUp, LATE_MS, missedSince, nextRuns } from "./clock.ts";
import { saveResult } from "./results.ts";
import { claimantOf, goneReason, pastShare, resultOf, startRunTask } from "./run-task.ts";

const HOUR_MS = 60 * 60 * 1000;
const FAILURES_TO_PAUSE = 3;
const SWEEP_MS = 60_000;
// Bounds a chain or a burst of Run now: no automation starts more often than this in a day.
const MOST_RUNS_A_DAY = 48;

const runsText = (count: number) => (count === 1 ? "1 run was" : `${count} runs were`);

export type FireBy = AutomationRun["by"];

// Every start of an automation, whatever its trigger: write the run under its key, check its own
// rules, then hand it to the admission queue (D-125). The run record is the truth.
export class Runner {
  readonly #context: TeamContext;
  readonly #notifier: Notifier;
  readonly #nameTask: NameTask;
  readonly #clock: Clock;
  #queue: AdmissionQueue | undefined;
  #sweep: NodeJS.Timeout | undefined;

  constructor(context: TeamContext, notifier: Notifier, nameTask: NameTask) {
    this.#context = context;
    this.#notifier = notifier;
    this.#nameTask = nameTask;
    const { automations } = context.store;
    this.#clock = new Clock(
      () => automations.earliestNextRun(),
      (now) => automations.due(now),
      (due) => {
        for (const automation of due) this.#scheduled(automation);
      },
    );
  }

  // Once the queue exists: carry on from the last launch, then follow every change.
  use(queue: AdmissionQueue): void {
    this.#queue = queue;
    const { store } = this.#context;
    store.subscribe((change) => this.#changed(change));
    this.#recover();
    for (const automation of store.automations.list()) this.refreshNext(automation.id);
    this.#clock.arm();
    this.#sweep = setInterval(() => this.#endUnanswered(), SWEEP_MS);
    this.#sweep.unref();
  }

  stop(): void {
    this.#clock.stop();
    clearInterval(this.#sweep);
  }

  // The next run from now, for one that is on, not paused and on a schedule.
  refreshNext(automationId: string): void {
    const { automations } = this.#context.store;
    const automation = automations.get(automationId);
    if (automation === undefined) return;
    const { trigger } = automation;
    const runs = automation.latestRun?.number ?? 0;
    const next =
      automation.enabled && automation.paused === undefined && trigger.kind === "schedule"
        ? nextRuns(trigger, new Date(), 1, runs)[0]
        : undefined;
    automations.setNextRun(automationId, next);
    this.#clock.arm();
  }

  runNow(automationId: string): AutomationRun | undefined {
    const automation = this.#context.store.automations.get(automationId);
    if (automation === undefined) return undefined;
    return this.fire(automation, new Date(), "now", 0);
  }

  cancel(runId: string, reason = "You cancelled it."): void {
    const run = this.#context.store.automations.getRun(runId);
    if (run?.status !== "waiting") return;
    this.#context.store.automations.updateRun(runId, {
      status: "skipped",
      reason,
      endedAt: new Date().toISOString(),
    });
    this.#queue?.cancel({ kind: "run", runId }, reason);
  }

  // Turning it off or a pause: what waits is skipped; a run at work finishes.
  cancelWaiting(automationId: string, reason: string): void {
    for (const run of this.#context.store.automations.openRuns(automationId)) {
      if (run.status === "waiting") this.cancel(run.id, reason);
    }
  }

  // Undefined when that slot already fired.
  fire(
    automation: AutomationRecord,
    slot: Date,
    by: FireBy,
    depth: number,
    note?: { reason: string; missed?: number },
  ): AutomationRun | undefined {
    const { automations } = this.#context.store;
    const skipped = this.#skipReason(automation, depth);
    const waitUntil = new Date(Date.now() + automation.rules.waitHours * HOUR_MS);
    const run = automations.addRun({
      automationId: automation.id,
      scheduledFor: slot,
      by,
      depth,
      status: skipped === undefined ? "waiting" : "skipped",
      ...(skipped === undefined
        ? { waitUntil, ...(note === undefined ? {} : note) }
        : { reason: skipped }),
    });
    if (run !== undefined && run.status === "waiting") {
      this.#queue?.add({ kind: "run", runId: run.id }, waitUntil);
    }
    return run;
  }

  waitFor(runId: string): Wait | undefined {
    const { store } = this.#context;
    const run = store.automations.getRun(runId);
    const automation = run === undefined ? undefined : store.automations.get(run.automationId);
    if (run === undefined || automation === undefined) return undefined;
    return waitOn(store, claimantOf(store, automation, run), undefined, automation.rules.waitHours);
  }

  async start(runId: string): Promise<void> {
    const { store } = this.#context;
    const run = store.automations.getRun(runId);
    if (run === undefined) throw new Error("The run was deleted.");
    const automation = store.automations.get(run.automationId);
    if (automation === undefined) throw new Error("Its automation was deleted.");
    const gone = goneReason(store, automation);
    if (gone !== undefined) {
      this.#pause(automation, gone.reason, gone.fix);
      throw new Error(gone.reason);
    }
    const taskId = await startRunTask(this.#context, automation, run, this.#nameTask);
    const entry = this.#queue?.entryOf({ kind: "run", runId });
    if (entry !== undefined) store.queue.setTask(entry.id, taskId);
    const task = store.getTask(taskId);
    if (task !== undefined) this.#follow(task);
  }

  #skipReason(automation: AutomationRecord, depth: number): string | undefined {
    const { automations } = this.#context.store;
    const past = pastShare(this.#context.store, automation);
    if (past !== undefined) return past;
    if (depth > CHAIN_DEPTH) {
      return `It would be run ${depth} of a chain, past the most of ${CHAIN_DEPTH}, so the chain stopped here.`;
    }
    const open = automations.openRuns(automation.id);
    const waiting = open.find((run) => run.status === "waiting");
    if (waiting !== undefined) return `Run ${waiting.number} was still waiting.`;
    const asking = open.find((run) => run.status === "needs");
    if (asking !== undefined && automation.rules.answerWithinHours === null) {
      return `Run ${asking.number} is still waiting for you.`;
    }
    const ran = automations
      .runs(automation.id, { limit: MOST_RUNS_A_DAY * 2 })
      .runs.filter(
        (run) => run.status !== "skipped" && Date.now() - Date.parse(run.createdAt) < 24 * HOUR_MS,
      );
    if (ran.length >= MOST_RUNS_A_DAY) return `It already ran ${MOST_RUNS_A_DAY} times today.`;
    return undefined;
  }

  // Due on its schedule: on time, or late after a close or a sleep (principle 8).
  #scheduled(automation: AutomationRecord): void {
    const { trigger, nextRunAt } = automation;
    if (trigger.kind !== "schedule" || nextRunAt === undefined) return;
    const slot = new Date(nextRunAt);
    const now = new Date();
    const missed = missedSince(trigger, slot, now);
    if (missed === undefined || (missed.count === 1 && now.getTime() - slot.getTime() <= LATE_MS)) {
      this.fire(automation, slot, "schedule", 0);
    } else if (catchUp(missed, automation.rules.catchUpHours, now)) {
      const earlier = missed.count - 1;
      this.fire(automation, missed.latest, "schedule", 0, {
        reason:
          earlier === 0
            ? "It ran late, as Office Town was closed or asleep at its time."
            : `It ran late; ${runsText(earlier)} missed while Office Town was closed.`,
        ...(earlier === 0 ? {} : { missed: earlier }),
      });
    } else {
      this.#context.store.automations.addRun({
        automationId: automation.id,
        scheduledFor: missed.latest,
        by: "schedule",
        depth: 0,
        status: "skipped",
        missed: missed.count,
        reason: `${runsText(missed.count)} missed while Office Town was closed.`,
      });
      this.#notifier.notify(
        "automation",
        undefined,
        `${automation.name} missed ${missed.count === 1 ? "a run" : `${missed.count} runs`}`,
        "Office Town was closed at its time.",
      );
    }
    this.refreshNext(automation.id);
  }

  #changed(change: Change): void {
    if (change.type === "task") this.#follow(change.task);
    if (change.type === "queue" && change.entry.what.kind === "run") this.#queued(change.entry);
    if (change.type === "department.removed" || change.type === "department") this.#checkGone();
  }

  // The queue's wait and skip, told on the run.
  #queued(entry: Extract<Change, { type: "queue" }>["entry"]): void {
    if (entry.what.kind !== "run") return;
    const { automations } = this.#context.store;
    const run = automations.getRun(entry.what.runId);
    if (run?.status !== "waiting") return;
    if (entry.state === "skipped" || entry.state === "cancelled") {
      automations.updateRun(run.id, {
        status: "skipped",
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
        endedAt: new Date().toISOString(),
      });
    } else if (entry.state === "waiting" && entry.reason !== undefined) {
      automations.updateRun(run.id, { reason: entry.reason });
    }
  }

  // A run shows its task's own status (D-125).
  #follow(task: TaskRecord): void {
    const { store } = this.#context;
    if (task.origin?.kind !== "automation") return;
    const run = store.automations.getRun(task.origin.runId);
    if (run === undefined) return;
    const status = statusOf(this.#context, task);
    // Once over, it still shows its task's status, such as Done after a review.
    if (run.endedAt !== undefined) {
      store.automations.updateRun(run.id, { status });
      return;
    }
    // An interrupted run waits to resume; only a real end counts.
    const ended = task.state === "ended" || status === "review";
    const updated = store.automations.updateRun(run.id, {
      status,
      taskId: task.id,
      // Its wait was for the start; any reason left is from then.
      ...(run.status === "waiting" ? { reason: undefined, waitUntil: undefined } : {}),
      ...(ended ? { endedAt: new Date().toISOString() } : {}),
    });
    if (ended && updated !== undefined) this.#ended(updated, task);
  }

  #ended(run: AutomationRun, task: TaskRecord): void {
    const { store } = this.#context;
    const automation = store.automations.get(run.automationId);
    if (automation === undefined) return;
    const finished = run.status === "review" || run.status === "done";
    if (run.status === "failed") {
      const failures = automation.failures + 1;
      store.automations.setFailures(automation.id, failures);
      if (failures >= FAILURES_TO_PAUSE) {
        this.#pause(automation, `It failed ${FAILURES_TO_PAUSE} times in a row.`, "turn-on");
      }
    } else if (finished && automation.failures > 0) {
      store.automations.setFailures(automation.id, 0);
    }
    if (finished) {
      if (automation.rules.saveResult) saveResult(store, automation, run, resultOf(store, task));
      if (!automation.rules.review && run.status === "review") {
        markDone(this.#context, task.id).catch((error: unknown) => {
          console.error(`Could not mark run ${run.number} of ${automation.name} done.`, error);
        });
      }
    }
    for (const next of store.automations.list()) {
      const { trigger } = next;
      if (trigger.kind !== "after" || trigger.automationId !== automation.id) continue;
      if (!next.enabled || next.paused !== undefined) continue;
      if (trigger.outcome === "done" && !finished) continue;
      this.fire(next, new Date(), "chain", run.depth + 1);
    }
  }

  #pause(automation: AutomationRecord, reason: string, fix: "edit" | "turn-on" | "sign-in"): void {
    const { automations } = this.#context.store;
    if (automation.paused?.reason === reason) return;
    automations.setPaused(automation.id, { reason, fix });
    this.cancelWaiting(automation.id, `It was not run: ${automation.name} paused itself.`);
    this.refreshNext(automation.id);
    this.#notifier.notify("automation", undefined, `${automation.name} paused itself`, reason);
  }

  #checkGone(): void {
    const { store } = this.#context;
    for (const automation of store.automations.list()) {
      if (!automation.enabled || automation.paused !== undefined) continue;
      const gone = goneReason(store, automation);
      if (gone !== undefined) this.#pause(automation, gone.reason, gone.fix);
    }
  }

  // Waiting runs go back to the queue with their own deadline; runs cut off at work resume
  // through it on their own, as the user's own tasks wait for Home's card (D-125).
  #recover(): void {
    const { store } = this.#context;
    const now = Date.now();
    for (const run of store.automations.unendedRuns()) {
      if (run.status === "waiting" && run.taskId === undefined) {
        const until = run.waitUntil === undefined ? now : Date.parse(run.waitUntil);
        if (until <= now) {
          store.automations.updateRun(run.id, {
            status: "skipped",
            reason: "Office Town was closed past how long it could wait.",
            endedAt: new Date().toISOString(),
          });
        } else this.#queue?.add({ kind: "run", runId: run.id }, new Date(until));
        continue;
      }
      const task = run.taskId === undefined ? undefined : store.getTask(run.taskId);
      if (task === undefined) continue;
      const top = topSession(task, store.listSessions(task.id));
      if (top?.status === "interrupted" && task.paused === undefined) {
        // A chief's goal brings its cut-off parts along, as Home's card would.
        const parts = store.listPieces(task.id).flatMap((piece) => {
          const part =
            piece.pieceTaskId === undefined ? undefined : store.getTask(piece.pieceTaskId);
          const cut =
            part && topSession(part, store.listSessions(part.id))?.status === "interrupted";
          return cut && part ? [part.id] : [];
        });
        for (const id of [task.id, ...parts]) this.#queue?.add({ kind: "resume", taskId: id });
      } else this.#follow(task);
    }
    const due = store.automations.due(now);
    for (const automation of due) this.#scheduled(automation);
  }

  // A run waiting on the user past its rule ends, so later runs can go (D-118).
  #endUnanswered(): void {
    const { store } = this.#context;
    const asking = new Map<string, number>();
    for (const { taskId, event } of store.listPendingRequests().requests) {
      const at = Date.parse(event.timestamp);
      asking.set(taskId, Math.min(at, asking.get(taskId) ?? at));
    }
    for (const run of store.automations.unendedRuns()) {
      if (run.status !== "needs" || run.taskId === undefined) continue;
      const since = asking.get(run.taskId);
      const automation = store.automations.get(run.automationId);
      const hours = automation?.rules.answerWithinHours;
      if (since === undefined || hours == null || Date.now() - since < hours * HOUR_MS) {
        continue;
      }
      const taskId = run.taskId;
      store.automations.updateRun(run.id, {
        reason: `No one answered within ${hours === 1 ? "an hour" : `${hours} hours`}, so it was stopped.`,
      });
      const stopping = isChiefTask(store, taskId)
        ? stopChiefGoal(this.#context, taskId)
        : stopTeam(this.#context, taskId);
      stopping.catch((error: unknown) => {
        console.error(`Could not stop run ${run.number}, unanswered.`, error);
      });
    }
  }
}

export function statusOf({ store }: Pick<TeamContext, "store">, task: TaskRecord): RunStatus {
  const sessions = store.listSessions(task.id);
  const openPieces = store
    .listPieces(task.id)
    .some(
      (piece) =>
        piece.status === "waiting" || piece.status === "queued" || piece.status === "working",
    );
  return taskStatus(
    {
      state: task.state,
      reviewed: task.reviewedAt !== undefined,
      isPart: task.parentTaskId !== undefined,
      openPieces,
    },
    topSession(task, sessions)?.status,
  );
}
