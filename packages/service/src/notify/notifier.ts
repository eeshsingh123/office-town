import { randomUUID } from "node:crypto";
import {
  type AutomationRecord,
  type AutomationRun,
  NOTICE_DEFAULTS,
  type NoticeKind,
  type SessionEvent,
  type TaskRecord,
  type UserProfile,
} from "@office-town/contract";
import { accountTitle } from "../accounts/accounts.ts";
import { isChiefTask } from "../chief/chief.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { SendOwner } from "../store/destinations-store.ts";
import type { Store } from "../store/store.ts";
import { resultOf, statusOf, topSession } from "../team/task-state.ts";
import { askMessage, isAsk } from "./asks.ts";
import type { Outbox, Queued } from "./outbox.ts";

// Where a task's result is ready to send.
const OVER = new Set(["review", "done"]);

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
  automation: (count) => ({
    title: `${count} more ${count === 1 ? "automation" : "automations"} paused or missed runs`,
    body: "",
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
  // Send result was on, so a finish or failure after this is sent; one before it never is.
  sends: boolean;
  finished: boolean;
  failed: boolean;
}

const NONE: ReadonlySet<string> = new Set();

// The core decides what deserves an alert: a notice the window shows while it is not in front
// (D-124), and the same words to every connected place ticked for its kind. An alert never carries
// an agent's own text; a result goes out only where its task or automation asked.
export class Notifier {
  readonly #store: Store;
  readonly #windows = new Map<NoticeKind, Window>();
  // By kind and task, when it last alerted.
  readonly #recent = new Map<string, number>();
  readonly #asks = new Set<NodeJS.Timeout>();
  // The tasks that changed in this launch, so a change into ended or paused is told once.
  readonly #seen = new Map<string, Seen>();

  readonly #outbox: Outbox;

  constructor(store: Store, registry: SessionRegistry, outbox: Outbox) {
    this.#store = store;
    this.#outbox = outbox;
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

  // Places in `except` hear it in their automation's own message instead.
  notify(
    kind: NoticeKind,
    taskId: string | undefined,
    title: string,
    body: string,
    except: ReadonlySet<string> = NONE,
  ): void {
    const places = this.#placesFor(kind).filter((id) => !except.has(id));
    if (!this.#enabled(kind) && places.length === 0) return;
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
    this.#tell(kind, taskId, title, body, places);
    const timer = setTimeout(() => this.#closeWindow(kind), WINDOW_MS);
    timer.unref();
    this.#windows.set(kind, { extra: 0, timer });
  }

  automationPaused(automation: AutomationRecord, reason: string): void {
    const own = new Set(automation.rules.sendTo ?? []);
    this.notify("automation", undefined, `${automation.name} is paused`, reason, own);
    this.#sendOut(automation, `paused:${Date.now()}`, undefined, {
      kind: "alert",
      title: automation.name,
      text: `Paused: ${reason}`,
    });
  }

  // A run's result or failure goes to its automation's destinations; nothing new sends nothing
  // (D-130, D-131). The result is the text the Library keeps, never a trace or another file.
  runEnded(automation: AutomationRecord, run: AutomationRun, result: string): void {
    const finished = run.status === "done" || run.status === "review";
    // A run that failed after reporting nothing new is still told.
    if (finished && run.quiet === true) return;
    const title = `${automation.name} · run ${run.number}`;
    if (finished && result.trim() !== "") {
      this.#sendOut(automation, `result:${run.id}`, run.id, {
        kind: "result",
        title,
        text: result.trim(),
      });
    } else if (run.status === "failed") {
      this.#sendOut(automation, `failed:${run.id}`, run.id, {
        kind: "alert",
        title,
        text: `It failed.${run.reason === undefined ? "" : ` ${run.reason}`} Open it in Office Town to see why.`,
      });
    }
  }

  // An automation's run, or a part of a chief's goal one started, asks: its destinations hear it.
  #askOut(event: Parameters<typeof askMessage>[0], task: TaskRecord, who: string): void {
    const goal = task.parentTaskId === undefined ? task : this.#store.getTask(task.parentTaskId);
    const origin = goal?.origin;
    if (origin?.kind !== "automation") return;
    const automation = this.#store.automations.get(origin.automationId);
    if (automation === undefined) return;
    const title = `${automation.name} · run ${origin.run}`;
    this.#sendOut(
      automation,
      `ask:${event.sessionId}:${event.payload.requestId}`,
      origin.runId,
      askMessage(event, who, title),
    );
  }

  // Every place is one way: an ask is answered in Office Town (D-130).
  #sendOut(
    automation: AutomationRecord,
    key: string,
    runId: string | undefined,
    message: Queued,
  ): void {
    const owner = { automationId: automation.id, ...(runId === undefined ? {} : { runId }) };
    this.#queue(automation.rules.sendTo ?? [], key, owner, message);
  }

  #queue(placeIds: readonly string[], key: string, owner: SendOwner, message: Queued): void {
    for (const id of placeIds) {
      const destination = this.#store.destinations.get(id);
      if (destination !== undefined) this.#outbox.queue(destination, key, owner, message);
    }
  }

  // The notice for this computer, if its switch is on, and the same words to the places given.
  #tell(
    kind: NoticeKind,
    taskId: string | undefined,
    title: string,
    body: string,
    places: readonly string[],
  ): void {
    if (this.#enabled(kind)) {
      this.#store.notices.create({
        kind,
        ...(taskId === undefined ? {} : { taskId }),
        title,
        body,
      });
    }
    this.#queue(places, `notice:${randomUUID()}`, {}, { kind: "alert", title, text: body });
  }

  #closeWindow(kind: NoticeKind): void {
    const window = this.#windows.get(kind);
    this.#windows.delete(kind);
    if (window === undefined || window.extra === 0) return;
    const { title, body } = MORE[kind](window.extra);
    this.#tell(kind, undefined, title, body, this.#placesFor(kind));
  }

  #enabled(kind: NoticeKind): boolean {
    return this.#store.readSettings().notifications?.[kind] ?? NOTICE_DEFAULTS[kind];
  }

  #placesFor(kind: NoticeKind): string[] {
    return this.#store.readSettings().updateRoutes?.[kind] ?? [];
  }

  // The places an automation's run, or a part of a chief's goal one started, speaks to itself.
  #automationPlaces(task: TaskRecord): ReadonlySet<string> {
    const goal = task.parentTaskId === undefined ? task : this.#store.getTask(task.parentTaskId);
    const origin = goal?.origin;
    if (origin?.kind !== "automation") return NONE;
    return new Set(this.#store.automations.get(origin.automationId)?.rules.sendTo ?? []);
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
      this.#askStillWaits(event, requestId, want);
    }, ASK_SETTLES_MS);
    timer.unref();
    this.#asks.add(timer);
  }

  #askStillWaits(event: SessionEvent, requestId: string, want: string): void {
    const { sessionId } = event;
    const waiting = this.#store
      .listPendingRequests()
      .requests.some(
        ({ event }) => event.sessionId === sessionId && event.payload.requestId === requestId,
      );
    const session = this.#store.getSession(sessionId);
    const task = this.#taskOf(sessionId);
    if (!waiting || session === undefined || task === undefined) return;
    const name = this.#store.getAgent(session.agentId)?.name ?? "An agent";
    if (isAsk(event)) this.#askOut(event, task, name);
    const own = isAsk(event) ? this.#automationPlaces(task) : NONE;
    this.notify("needs-you", task.id, `${name} ${want}`, taskName(task), own);
  }

  #taskOf(sessionId: string): TaskRecord | undefined {
    const taskId = this.#store.getSession(sessionId)?.taskId;
    return taskId === undefined ? undefined : this.#store.getTask(taskId);
  }

  // A part of a chief's goal reports to the chief, so only the whole goal alerts.
  #taskChanged(task: TaskRecord): void {
    const before = this.#seen.get(task.id);
    const sends = this.#wantsResult(task);
    const status = sends ? statusOf(this.#store, task) : undefined;
    const now: Seen = {
      ended: task.state === "ended",
      paused: task.paused !== undefined,
      sends,
      finished: status !== undefined && OVER.has(status),
      failed: status === "failed",
    };
    this.#seen.set(task.id, now);
    if (before === undefined) return;
    if (before.sends && now.finished && !before.finished) this.#resultOut(task);
    if (before.sends && now.failed && !before.failed) this.#failedOut(task);
    if (now.paused && !before.paused) this.#paused(task);
    if (!now.ended || before.ended || task.parentTaskId !== undefined) return;
    // An automation's check speaks through its automation, not as a task of its own.
    if (task.origin?.kind === "check") return;
    if (task.reviewedAt !== undefined) return;
    const top = topSession(task, this.#store.listSessions(task.id));
    // A run with nothing new stays quiet unless it then failed (D-131).
    if (task.origin?.kind === "automation" && top?.status !== "failed") {
      if (this.#store.automations.getRun(task.origin.runId)?.quiet === true) return;
    }
    const own = this.#automationPlaces(task);
    if (top?.status === "failed") {
      this.notify("failed", task.id, "A task failed", taskName(task), own);
    } else if (top?.status !== "stopped" && top?.status !== "interrupted") {
      this.notify("finished", task.id, "A task is finished", taskName(task), own);
    }
  }

  // Send result to: only a task a person started, never an automation's or a part of a goal.
  #wantsResult(task: TaskRecord): boolean {
    return task.sendResult === true && task.origin === undefined && task.parentTaskId === undefined;
  }

  // Once a task, to Settings' result places, as the text its lead or assistant ended with.
  #resultOut(task: TaskRecord): void {
    const result = resultOf(this.#store, task).trim();
    if (result === "") return;
    this.#taskOut(task, "task-result", {
      kind: "result",
      title: this.#taskTitle(task),
      text: result,
    });
  }

  // Where its result was awaited, a failure is told once, in the core's words only.
  #failedOut(task: TaskRecord): void {
    this.#taskOut(task, "task-failed", {
      kind: "alert",
      title: this.#taskTitle(task),
      text: "It failed. Open it in Office Town to see why.",
    });
  }

  #taskOut(task: TaskRecord, key: string, message: Queued): void {
    const places = this.#store.readSettings().resultPlaces ?? [];
    this.#queue(places, `${key}:${task.id}`, { taskId: task.id }, message);
  }

  #taskTitle(task: TaskRecord): string {
    return `${teamName(this.#store, task)} · ${taskName(task)}`;
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
