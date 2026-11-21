import {
  NOTICE_DEFAULTS,
  type NoticeKind,
  type SessionEvent,
  type TaskRecord,
  type UserProfile,
} from "@office-town/contract";
import { accountTitle } from "../accounts/accounts.ts";
import { isChiefTask } from "../chief/chief.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { topSession } from "../team/task-state.ts";

// Coalescing (D-124): the first of a kind at once, the rest of that window once at its end.
const WINDOW_MS = 5 * 60_000;
// An ask the level answers on its own is gone by then, so it never alerts.
const ASK_SETTLES_MS = 3_000;
const SHOWN_NAME = 80;

const MORE: Record<NoticeKind, (count: number) => { title: string; body: string }> = {
  "needs-you": (count) => ({
    title: `${count} more ${count === 1 ? "ask needs" : "asks need"} you`,
    body: "",
  }),
  finished: (count) => ({ title: `${count} more ${tasks(count)} finished`, body: "" }),
  failed: (count) => ({ title: `${count} more ${tasks(count)} failed`, body: "" }),
  "lead-stopped": (count) => ({
    title: `${count} more ${count === 1 ? "lead" : "leads"} stopped after an error`,
    body: "",
  }),
  "work-stopped": (count) => ({ title: stoppedTitle(count), body: "" }),
  "usage-paused": (count) => ({
    title: "Work paused: your usage is running out",
    body: `${count} more ${tasks(count)} stopped.`,
  }),
};

const tasks = (count: number) => (count === 1 ? "task" : "tasks");

export const stoppedTitle = (count: number) =>
  `${count} ${tasks(count)} stopped when Office Town closed.`;

export function taskName(task: TaskRecord): string {
  const name = task.title ?? task.prompt.split("\n")[0]?.trim() ?? "";
  return name.length > SHOWN_NAME ? `${name.slice(0, SHOWN_NAME)}…` : name;
}

// "Content team", "The chief", or the agent working alone.
export function teamName(store: Store, task: TaskRecord): string {
  if (isChiefTask(store, task.id)) return "The chief";
  const department =
    task.departmentId === undefined ? undefined : store.getDepartment(task.departmentId);
  if (department !== undefined) return department.name;
  const agentId = task.leadAgentId ?? store.listSessions(task.id)[0]?.agentId;
  return (agentId === undefined ? undefined : store.getAgent(agentId)?.name) ?? "An agent";
}

type PermissionRequest = Extract<SessionEvent, { type: "permission.requested" }>;

const WANTS: Partial<Record<NonNullable<PermissionRequest["payload"]["kind"]>, string>> = {
  execute: "wants to run a command",
  edit: "wants to change a file",
  delete: "wants to delete a file",
  move: "wants to move a file",
  read: "wants to read a file",
  search: "wants to search",
  fetch: "wants to open a web page",
};

// What an agent wants, from the kind of its ask, never from the ask's own words.
function wantOf(event: SessionEvent): string | undefined {
  switch (event.type) {
    case "permission.requested":
      if (event.payload.tool !== undefined) return "wants to use an app";
      return WANTS[event.payload.kind ?? "other"] ?? "wants your OK";
    case "question.requested":
      return "asks a question";
    case "proposal.requested":
      return event.payload.departmentId === undefined
        ? "proposes a team"
        : "wants to change the team";
    case "plan.requested":
      return event.payload.replan ? "wants to change the plan" : "proposes a plan";
    case "checklist.requested":
      return "has a checklist to approve";
    default:
      return undefined;
  }
}

// The switches once lived on the user's profile; they move to Settings once (D-124).
function moveSwitches(store: Store): void {
  const { you, notifications } = store.readSettings();
  const old = you as
    | (UserProfile & { notifyNeedsYou?: boolean; notifyFinished?: boolean })
    | undefined;
  if (old === undefined || (old.notifyNeedsYou === undefined && old.notifyFinished === undefined)) {
    return;
  }
  const { notifyNeedsYou, notifyFinished, ...rest } = old;
  store.saveSettings({
    you: rest,
    ...(notifications === undefined
      ? {
          notifications: {
            "needs-you": notifyNeedsYou ?? NOTICE_DEFAULTS["needs-you"],
            finished: notifyFinished ?? NOTICE_DEFAULTS.finished,
          },
        }
      : {}),
  });
}

interface Window {
  extra: number;
  timer: NodeJS.Timeout;
}

interface Seen {
  ended: boolean;
  paused: boolean;
}

// The core decides what deserves an alert and stores it as a notice; the window shows each one
// while it is not in front (D-124). A notice never carries an agent's own text.
export class Notifier {
  readonly #store: Store;
  readonly #windows = new Map<NoticeKind, Window>();
  // By kind and task, when it last alerted.
  readonly #recent = new Map<string, number>();
  readonly #asks = new Set<NodeJS.Timeout>();
  // The tasks that changed in this launch, so a change into ended or paused is told once.
  readonly #seen = new Map<string, Seen>();

  constructor(store: Store, registry: SessionRegistry) {
    this.#store = store;
    moveSwitches(store);
    registry.subscribe(({ event }) => this.#heard(event));
    store.subscribe((change) => {
      if (change.type === "task") this.#taskChanged(change.task);
      if (change.type === "task.deleted") this.#seen.delete(change.taskId);
    });
  }

  stop(): void {
    for (const { timer } of this.#windows.values()) clearTimeout(timer);
    for (const timer of this.#asks) clearTimeout(timer);
  }

  notify(kind: NoticeKind, taskId: string | undefined, title: string, body: string): void {
    if (!this.#enabled(kind)) return;
    const now = Date.now();
    for (const [key, at] of this.#recent) if (now - at >= WINDOW_MS) this.#recent.delete(key);
    if (taskId !== undefined) {
      const key = `${kind}/${taskId}`;
      if (this.#recent.has(key)) return;
      this.#recent.set(key, now);
    }
    const open = this.#windows.get(kind);
    if (open !== undefined) {
      open.extra += 1;
      return;
    }
    this.#store.notices.create({ kind, ...(taskId === undefined ? {} : { taskId }), title, body });
    const timer = setTimeout(() => this.#closeWindow(kind), WINDOW_MS);
    timer.unref();
    this.#windows.set(kind, { extra: 0, timer });
  }

  #closeWindow(kind: NoticeKind): void {
    const window = this.#windows.get(kind);
    this.#windows.delete(kind);
    if (window === undefined || window.extra === 0 || !this.#enabled(kind)) return;
    this.#store.notices.create({ kind, ...MORE[kind](window.extra) });
  }

  #enabled(kind: NoticeKind): boolean {
    return this.#store.readSettings().notifications?.[kind] ?? NOTICE_DEFAULTS[kind];
  }

  #heard(event: SessionEvent): void {
    if (event.type === "retry.requested") {
      const task = this.#taskOf(event.sessionId);
      if (task === undefined) return;
      const title = isChiefTask(this.#store, task.id)
        ? "The chief stopped after an error."
        : `${teamName(this.#store, task)}'s lead stopped after an error.`;
      this.notify("lead-stopped", task.id, title, taskName(task));
      return;
    }
    const want = wantOf(event);
    if (want === undefined || !("requestId" in event.payload)) return;
    const { requestId } = event.payload;
    const timer = setTimeout(() => {
      this.#asks.delete(timer);
      this.#askStillWaits(event.sessionId, requestId, want);
    }, ASK_SETTLES_MS);
    timer.unref();
    this.#asks.add(timer);
  }

  #askStillWaits(sessionId: string, requestId: string, want: string): void {
    const waiting = this.#store
      .listPendingRequests()
      .requests.some(
        ({ event }) => event.sessionId === sessionId && event.payload.requestId === requestId,
      );
    const session = this.#store.getSession(sessionId);
    const task = this.#taskOf(sessionId);
    if (!waiting || session === undefined || task === undefined) return;
    const name = this.#store.getAgent(session.agentId)?.name ?? "An agent";
    this.notify("needs-you", task.id, `${name} ${want}`, taskName(task));
  }

  #taskOf(sessionId: string): TaskRecord | undefined {
    const taskId = this.#store.getSession(sessionId)?.taskId;
    return taskId === undefined ? undefined : this.#store.getTask(taskId);
  }

  // A part of a chief's goal reports to the chief, so only the whole goal alerts.
  #taskChanged(task: TaskRecord): void {
    const before = this.#seen.get(task.id);
    const now: Seen = { ended: task.state === "ended", paused: task.paused !== undefined };
    this.#seen.set(task.id, now);
    if (before === undefined) return;
    if (now.paused && !before.paused) this.#paused(task);
    if (!now.ended || before.ended || task.parentTaskId !== undefined) return;
    if (task.reviewedAt !== undefined) return;
    const top = topSession(task, this.#store.listSessions(task.id));
    if (top?.status === "failed") this.notify("failed", task.id, "A task failed", taskName(task));
    else if (top?.status !== "stopped" && top?.status !== "interrupted") {
      this.notify("finished", task.id, "A task is finished", taskName(task));
    }
  }

  #paused(task: TaskRecord): void {
    const { paused } = task;
    if (paused === undefined) return;
    const percent = Math.round(paused.usedFraction * 100);
    const account = accountTitle(this.#store, paused.accountId);
    this.notify(
      "usage-paused",
      task.id,
      "Work paused: your usage is running out",
      `${teamName(this.#store, task)}'s task stopped at ${percent}% of ${account}'s ${paused.window} limit.`,
    );
  }
}
