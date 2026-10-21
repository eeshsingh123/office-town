import {
  defaultAccountId,
  type SessionOptions,
  type TaskPause,
  type TaskSummary,
  type UsageLimit,
} from "@office-town/contract";
import { isOpen } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { claimDepartment, continueTeam } from "./team-tasks.ts";

// Owner: past this the plan soon refuses every turn, which would leave work failed mid-step (D-72).
export const PAUSE_AT = 0.95;
// A minute late, so the plan has surely reset.
const RESET_GRACE_MS = 60_000;
const LONGEST_WAIT_MS = 2 ** 31 - 1;

const accountOf = (options: SessionOptions) =>
  options.accountId ?? defaultAccountId(options.harness, options.environment);

// Whole tasks pause, every agent in them, so no lead or worker reacts to another's sudden stop.
export class UsagePauses {
  readonly #context: TeamContext;
  // Each window is paused for once per reset; after "Resume now" the user decides.
  readonly #handled = new Set<string>();
  readonly #waits = new Map<string, NodeJS.Timeout>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => {
      if (event.type === "limits.updated") this.#check(event.sessionId, event.payload.limits);
      // Carried on some other way, such as a message to its lead.
      if (event.type === "session.started") this.#clear(event.sessionId);
    });
    for (const { paused } of context.store.listPausedTasks()) {
      if (paused?.resumeAt !== undefined) this.#wait(paused.accountId, paused.resumeAt);
    }
  }

  // Now, or at `at` (the window's reset); a wait survives a restart in the task's record.
  async resume(accountId: string, at?: string): Promise<void> {
    const tasks = this.#pausedOn(accountId);
    if (at !== undefined) {
      for (const task of tasks) {
        if (task.paused !== undefined) {
          this.#context.store.setTaskPause(task.id, { ...task.paused, resumeAt: at });
        }
      }
      this.#wait(accountId, at);
      return;
    }
    clearTimeout(this.#waits.get(accountId));
    this.#waits.delete(accountId);
    await Promise.all(tasks.map((task) => this.#carryOn(task)));
  }

  #pausedOn(accountId: string): TaskSummary[] {
    return this.#context.store
      .listPausedTasks()
      .filter((task) => task.paused?.accountId === accountId);
  }

  #check(sessionId: string, limits: UsageLimit[]): void {
    const session = this.#context.store.getSession(sessionId);
    const full = limits
      .filter((limit) => limit.usedFraction >= PAUSE_AT)
      .toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
    if (session === undefined || full === undefined) return;
    const accountId = accountOf(session.options);
    const key = `${accountId}/${full.id}/${full.resetsAt ?? ""}`;
    if (this.#handled.has(key)) return;
    this.#handled.add(key);
    void this.#pause(accountId, full).catch((error: unknown) => {
      console.error(`Could not pause the agents on ${accountId}.`, error);
    });
  }

  async #pause(accountId: string, limit: UsageLimit): Promise<void> {
    const { store, registry } = this.#context;
    const pause: TaskPause = {
      accountId,
      window: limit.label,
      usedFraction: limit.usedFraction,
      ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
    };
    const tasks = store
      .listActiveTasks()
      .filter((task) =>
        task.sessions.some(
          (session) => isOpen(session) && accountOf(session.options) === accountId,
        ),
      );
    for (const task of tasks) store.setTaskPause(task.id, pause);
    await Promise.all(
      tasks.map((task) => registry.pause(task.sessions.filter(isOpen).map(({ id }) => id))),
    );
  }

  #wait(accountId: string, at: string): void {
    clearTimeout(this.#waits.get(accountId));
    const wait = Math.min(
      LONGEST_WAIT_MS,
      Math.max(0, Date.parse(at) + RESET_GRACE_MS - Date.now()),
    );
    const timer = setTimeout(() => {
      this.#waits.delete(accountId);
      void this.resume(accountId).catch((error: unknown) => {
        console.error(`Could not resume the agents on ${accountId}.`, error);
      });
    }, wait);
    timer.unref();
    this.#waits.set(accountId, timer);
  }

  // A team carries on through its lead, told what was cut off; a lone agent where it stopped.
  async #carryOn(task: TaskSummary): Promise<void> {
    const { store, registry } = this.#context;
    store.setTaskPause(task.id, undefined);
    if (task.leadAgentId !== undefined) {
      await continueTeam(this.#context, task.id, undefined, [], "pause");
      return;
    }
    const latest = task.sessions.at(-1);
    if (latest === undefined) return;
    await claimDepartment(this.#context, task.departmentId, task.id, () =>
      registry.resume(latest.id, {
        text: "The usage pause is over. Carry on where you stopped.",
        origin: { kind: "notice", summary: "The usage pause is over" },
      }),
    );
  }

  #clear(sessionId: string): void {
    const { store } = this.#context;
    const taskId = store.getSession(sessionId)?.taskId;
    const task = taskId === undefined ? undefined : store.getTask(taskId);
    if (task?.paused !== undefined) store.setTaskPause(task.id, undefined);
  }
}
