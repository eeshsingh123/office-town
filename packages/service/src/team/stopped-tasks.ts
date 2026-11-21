import type { QueuedStart, StoppedTask, TaskSummary } from "@office-town/contract";
import { type Notifier, stoppedTitle } from "../notify/notifier.ts";
import type { AdmissionQueue } from "../queue/admission-queue.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { FolderNotFoundError, requireSessionFolders } from "../task-folders.ts";
import { type TeamContext, TeamError } from "./members.ts";
import { topSession } from "./task-state.ts";
import { claimDepartment, continueTeam } from "./team-tasks.ts";

// Past this many resumes cut off in a row, a crash loop is assumed and it stays stopped (D-122).
const MOST_ATTEMPTS = 2;

const RESUMED = {
  text: "Office Town closed while you worked. Carry on where you left off.",
  origin: { kind: "notice" as const, summary: "Work cut off by a restart" },
};

// The queue's start for a task a close or crash cut off: a team through its lead, told what was
// cut off, and a lone agent where it stopped, in its own folder (D-28).
export async function resumeTask(context: TeamContext, what: QueuedStart): Promise<void> {
  const { store, registry } = context;
  const task = store.getTask(what.taskId);
  if (task === undefined) throw new RecordNotFoundError("task");
  if (task.paused !== undefined) throw new TeamError("It is paused until your usage resets.");
  if (task.leadAgentId !== undefined) {
    await continueTeam(context, task.id, undefined);
  } else {
    const top = topSession(task, store.listSessions(task.id));
    if (top === undefined) throw new TeamError("It never started.");
    await claimDepartment(context, task.departmentId, task.id, () =>
      registry.resume(top.id, RESUMED),
    );
  }
  // Counted once it started, so only a resume cut off by a close or crash counts, not one refused.
  store.recovery.countResumeAttempt(task.id);
}

// The tasks a close or crash cut off, for Home's card. Nothing the user started resumes on its
// own: they choose (D-122).
export class StoppedTasks {
  readonly #context: TeamContext;
  readonly #queue: AdmissionQueue;

  constructor(context: TeamContext, queue: AdmissionQueue) {
    this.#context = context;
    this.#queue = queue;
    const { store, registry } = context;
    // A finished turn of its top agent means the resume took.
    registry.subscribe(({ event }) => {
      if (event.type !== "turn.ended" || event.payload.outcome !== "completed") return;
      const session = store.getSession(event.sessionId);
      const task = session === undefined ? undefined : store.getTask(session.taskId);
      if (task === undefined || session === undefined) return;
      if ((task.leadAgentId ?? store.listSessions(task.id)[0]?.agentId) !== session.agentId) return;
      store.recovery.clearResumeAttempts(task.id);
    });
  }

  list(): StoppedTask[] {
    return this.#shown(this.#closedAt());
  }

  // A chief's goal brings its cut-off parts along.
  resume(taskIds: readonly string[]): StoppedTask[] {
    const shown = this.list();
    for (const taskId of taskIds) {
      const row = shown.find((one) => one.taskId === taskId);
      if (row === undefined || row.reason !== undefined) continue;
      for (const id of [row.taskId, ...row.partIds])
        this.#queue.add({ kind: "resume", taskId: id });
    }
    return this.list();
  }

  // Hidden until a later close or crash cuts off new work.
  close(): void {
    this.#context.store.saveSettings({ stoppedCardClosedAt: new Date().toISOString() });
  }

  // Once at start, for work cut off since the last such notice.
  announce(notifier: Notifier): void {
    const notified = this.#context.store.notices.latestOf("work-stopped")?.createdAt;
    const since = Math.max(this.#closedAt(), notified === undefined ? 0 : Date.parse(notified));
    const count = this.#shown(since).length;
    if (count === 0) return;
    const body = count === 1 ? "Resume it from Home." : "Resume them from Home.";
    notifier.notify("work-stopped", undefined, stoppedTitle(count), body);
  }

  #closedAt(): number {
    const closed = this.#context.store.readSettings().stoppedCardClosedAt;
    return closed === undefined ? 0 : Date.parse(closed);
  }

  // One row per task cut off at or after this time; a chief's goal is one row with its parts.
  #shown(since: number): StoppedTask[] {
    const tasks = this.#cutOffSince(since);
    const listed = new Set(tasks.map((task) => task.id));
    return tasks
      .filter((task) => task.parentTaskId === undefined || !listed.has(task.parentTaskId))
      .map((task) => {
        const partIds = tasks.filter((part) => part.parentTaskId === task.id).map(({ id }) => id);
        const reason = this.#unresumable(task);
        const entry = this.#queue.entryOf({ kind: "resume", taskId: task.id });
        return {
          taskId: task.id,
          partIds,
          ...(reason === undefined ? {} : { reason }),
          ...(entry === undefined ? {} : { entry }),
        };
      });
  }

  // Tasks whose top agent was cut off at or after this time and never resumed. A task paused for its
  // usage keeps its pause (D-72).
  #cutOffSince(since: number): TaskSummary[] {
    const { store } = this.#context;
    return store.listInterruptedTasks(since).filter((task) => {
      if (task.paused !== undefined) return false;
      const top = topSession(task, task.sessions);
      return top !== undefined && (store.recovery.cutOffAt(top.id) ?? -1) >= since;
    });
  }

  #unresumable(task: TaskSummary): string | undefined {
    const { store } = this.#context;
    if (store.recovery.resumeAttempts(task.id) >= MOST_ATTEMPTS) {
      return "It stopped twice while resuming, so it was not resumed again.";
    }
    const top = topSession(task, task.sessions);
    if (top?.harnessSessionId === undefined) return "It never started.";
    // Only an account the user added has a record, and a folder of its own.
    const { accountId, accountFolder } = top.options;
    if (accountId !== undefined && accountFolder !== undefined && !store.getAccount(accountId)) {
      return "Its account was removed.";
    }
    try {
      requireSessionFolders(top.options);
    } catch (error) {
      if (error instanceof FolderNotFoundError) return "Its folder is gone.";
      throw error;
    }
    return undefined;
  }
}
