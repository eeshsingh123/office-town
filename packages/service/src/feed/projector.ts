import {
  FEED_BODY_CHARS,
  FEED_TITLE_CHARS,
  type FeedAuthor,
  type FeedPost,
  type MilestoneRecord,
  type PlanPiece,
  type SessionEvent,
  type SessionRecord,
  type TaskRecord,
  type UserRequestEvent,
  userRequestEventSchema,
} from "@office-town/contract";
import { accountTitle } from "../accounts/accounts.ts";
import { taskName, wantOf } from "../notify/notifier.ts";
import { redact } from "../notify/redact.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { PostDraft } from "../store/feed-store.ts";
import type { Store } from "../store/store.ts";
import { resultOf, statusOf, topSession } from "../team/task-state.ts";
import { suggestRepeat } from "./suggestions.ts";

// Changes are gathered and written together (D-138), so a burst of them is one write.
const FLUSH_MS = 250;
// An ask the level answers on its own never reaches the feed; nor does a lead's brief pause.
const SETTLES_MS = 3_000;
// Repeats closer together than this become one post.
const FOLD_MS = 5 * 60_000;
const PRUNE_MS = 60 * 60_000;
const EXCERPT_LINES = 10;

const AT_WORK = new Set(["working", "needs", "queued"]);

export const taskKey = (taskId: string) => `task:${taskId}`;
const askKey = (sessionId: string, requestId: string) => `ask:${sessionId}:${requestId}`;

export const clip = (text: string, most: number) =>
  text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`;

// The first lines of a result, cut at a line, with anything that looks like a secret hidden.
function excerptOf(text: string): string | undefined {
  const lines = redact(text).trim().split("\n").slice(0, EXCERPT_LINES);
  let excerpt = "";
  for (const line of lines) {
    if (excerpt.length + line.length + 1 > FEED_BODY_CHARS) break;
    excerpt = excerpt === "" ? line : `${excerpt}\n${line}`;
  }
  return excerpt.trim() === "" ? undefined : excerpt;
}

// A run's own first line, without its markdown, as an automation's headline.
function headlineOf(text: string): string | undefined {
  const line = redact(text)
    .split("\n")
    .map((each) => each.replace(/^[#>*\-\s]+|[*_`]+/g, "").trim())
    .find((each) => each !== "");
  return line === undefined ? undefined : clip(line, FEED_TITLE_CHARS);
}

const isRequest = (event: SessionEvent): event is UserRequestEvent =>
  userRequestEventSchema.safeParse(event).success;

// Office Town's own posts (D-137): a card per task at work that becomes its result, asks, stops,
// automation runs, parts and milestones. A post is a projection: the task keeps the record.
export class FeedProjector {
  readonly #store: Store;
  readonly #startedAt = Date.now();
  readonly #dirty = new Set<string>();
  readonly #jobs: (() => void)[] = [];
  readonly #timers = new Set<NodeJS.Timeout>();
  // Ends and parts already told in this launch, so a repeated change tells nothing twice.
  readonly #told = new Set<string>();
  #flushing: NodeJS.Timeout | undefined;
  #pruning: NodeJS.Timeout | undefined;

  constructor(store: Store, registry: SessionRegistry) {
    this.#store = store;
    registry.subscribe(({ event }) => this.#heard(event));
    store.subscribe((change) => {
      if (change.type === "task") this.#mark(change.task.id);
      if (change.type === "piece") this.#queue(() => this.#piece(change.piece));
      if (change.type === "milestone") this.#queue(() => this.#milestone(change.milestone));
    });
  }

  // After a restart: open asks and tasks at work are checked again, and what closed is closed.
  start(): void {
    const pending = this.#store.listPendingRequests().requests;
    const waiting = new Set(
      pending.map(({ event }) => askKey(event.sessionId, event.payload.requestId)),
    );
    this.#store.feed.batch(() => {
      for (const { event } of pending) this.#ask(event);
      for (const post of this.#store.feed.openKeyed("ask:")) {
        if (!waiting.has(askKey(post.sessionId ?? "", post.requestId ?? ""))) this.#answered(post);
      }
    });
    for (const post of this.#store.feed.openKeyed("task:")) {
      if (post.taskId !== undefined) this.#mark(post.taskId);
    }
    for (const task of this.#store.listActiveTasks()) this.#mark(task.id);
    this.#store.feed.prune();
    this.#pruning = setInterval(() => this.#store.feed.prune(), PRUNE_MS);
    this.#pruning.unref();
  }

  stop(): void {
    clearTimeout(this.#flushing);
    clearInterval(this.#pruning);
    for (const timer of this.#timers) clearTimeout(timer);
  }

  #mark(taskId: string): void {
    this.#dirty.add(taskId);
    this.#schedule();
  }

  #queue(job: () => void): void {
    this.#jobs.push(job);
    this.#schedule();
  }

  #later(job: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.#queue(job);
    }, SETTLES_MS);
    timer.unref();
    this.#timers.add(timer);
  }

  #schedule(): void {
    if (this.#flushing !== undefined) return;
    this.#flushing = setTimeout(() => this.#flush(), FLUSH_MS);
    this.#flushing.unref();
  }

  #flush(): void {
    this.#flushing = undefined;
    const taskIds = [...this.#dirty];
    const jobs = this.#jobs.splice(0);
    this.#dirty.clear();
    this.#store.feed.batch(() => {
      for (const taskId of taskIds) this.#task(taskId, false);
      for (const job of jobs) job();
    });
  }

  #heard(event: SessionEvent): void {
    if (isRequest(event)) {
      this.#later(() => this.#askIfWaiting(event));
      return;
    }
    if (!event.type.endsWith(".resolved") || !("requestId" in event.payload)) return;
    const key = askKey(event.sessionId, event.payload.requestId);
    this.#queue(() => {
      const post = this.#store.feed.byKey(key);
      if (post?.state === "open") this.#answered(post);
    });
  }

  #askIfWaiting(event: UserRequestEvent): void {
    const { sessionId } = event;
    const { requestId } = event.payload;
    const waiting = this.#store
      .listPendingRequests()
      .requests.some(
        (pending) =>
          pending.event.sessionId === sessionId && pending.event.payload.requestId === requestId,
      );
    if (waiting) this.#ask(event);
  }

  #ask(event: UserRequestEvent): void {
    const session = this.#store.getSession(event.sessionId);
    const task = session === undefined ? undefined : this.#store.getTask(session.taskId);
    if (session === undefined || task === undefined) return;
    const name = this.#store.getAgent(session.agentId)?.name ?? "An agent";
    const want =
      event.type === "retry.requested" ? "stopped after an error" : (wantOf(event) ?? "needs you");
    this.#store.feed.create(
      {
        kind: "needs-you",
        by: { kind: "agent", agentId: session.agentId },
        title: clip(`${name} ${want}`, FEED_TITLE_CHARS),
        body: taskName(task),
        taskId: task.id,
        sessionId: session.id,
        requestId: event.payload.requestId,
        ...this.#department(task, session.agentId),
        state: "open",
      },
      { key: askKey(session.id, event.payload.requestId) },
    );
  }

  #answered(post: FeedPost): void {
    const { id: _, createdAt: __, updatedAt: ___, ...draft } = post;
    this.#store.feed.update(post, { ...draft, state: "answered" });
  }

  // `settled`: an end seen again after a pause, so a lead's gap between turns is not an end.
  #task(taskId: string, settled: boolean): void {
    const task = this.#store.getTask(taskId);
    if (task === undefined || task.parentTaskId !== undefined) return;
    if (task.origin?.kind === "check") return;
    const sessions = this.#store.listSessions(taskId);
    const top = topSession(task, sessions);
    if (top === undefined) return;
    const living = this.#store.feed.byKey(taskKey(taskId));
    const status = statusOf(this.#store, task);
    if (task.paused === undefined && AT_WORK.has(status)) {
      this.#living(task, top, living);
      return;
    }
    // Once a turn: a reply that continues the task in the same session ends again later.
    const told = `${taskId}/${top.id}/${this.#store.latestTurn(top.id)?.at ?? ""}`;
    if (living === undefined) {
      if (this.#told.has(told)) return;
      // A task finished while Office Town was closed was never at work here: nothing to tell.
      if (Date.parse(top.createdAt) < this.#startedAt) return;
    }
    if (!settled) {
      this.#later(() => this.#task(taskId, true));
      return;
    }
    this.#told.add(told);
    const ended = this.#ended(task, top, status);
    if (ended === undefined) {
      if (living !== undefined) this.#store.feed.remove(living.id);
      return;
    }
    if (ended === "quiet") {
      if (living !== undefined) this.#store.feed.remove(living.id);
      this.#quietRun(task);
      return;
    }
    if (living === undefined) this.#store.feed.create(ended);
    else this.#store.feed.update(living, ended, { key: null, rise: true });
    if (ended.kind === "result") suggestRepeat(this.#store, task);
  }

  #living(task: TaskRecord, top: SessionRecord, living: FeedPost | undefined): void {
    const draft: PostDraft = {
      kind: "living",
      by: { kind: "agent", agentId: top.agentId },
      title: taskName(task),
      taskId: task.id,
      sessionId: top.id,
      ...this.#department(task, top.agentId),
      state: "open",
      ...(living?.note === undefined ? {} : { note: living.note }),
    };
    if (living === undefined) this.#store.feed.create(draft, { key: taskKey(task.id) });
    else this.#store.feed.update(living, draft);
  }

  // What a task that stopped working says: its result, why it stopped, or nothing for a stop the
  // user made.
  #ended(task: TaskRecord, top: SessionRecord, status: string): PostDraft | "quiet" | undefined {
    const base = {
      by: { kind: "agent", agentId: top.agentId } as FeedAuthor,
      title: taskName(task),
      taskId: task.id,
      sessionId: top.id,
      ...this.#department(task, top.agentId),
      state: "ended" as const,
    };
    if (task.paused !== undefined) {
      const { paused } = task;
      const percent = Math.round(paused.usedFraction * 100);
      const account = accountTitle(this.#store, paused.accountId);
      return {
        ...base,
        kind: "stopped",
        stopped: "usage",
        body: `Work paused: your usage is running out. It stopped at ${percent}% of ${account}'s ${paused.window} limit.`,
      };
    }
    if (status === "failed") return { ...base, kind: "stopped", stopped: "failed" };
    if (status === "stopped") {
      return top.status === "interrupted"
        ? { ...base, kind: "stopped", stopped: "closed", body: "Stopped when Office Town closed." }
        : undefined;
    }
    const result = resultOf(this.#store, task);
    const origin = task.origin;
    if (origin?.kind === "automation") {
      if (this.#store.automations.getRun(origin.runId)?.quiet === true) return "quiet";
      const excerpt = excerptOf(result);
      return {
        ...base,
        kind: "automation",
        by: { kind: "automation", automationId: origin.automationId, name: origin.name },
        title: headlineOf(result) ?? `${origin.name} · run ${origin.run}`,
        ...(excerpt === undefined ? {} : { body: excerpt }),
      };
    }
    const excerpt = excerptOf(result);
    return { ...base, kind: "result", ...(excerpt === undefined ? {} : { body: excerpt }) };
  }

  // A run with nothing new is one line a day per automation (D-131).
  #quietRun(task: TaskRecord): void {
    const origin = task.origin;
    if (origin?.kind !== "automation") return;
    const day = new Date().toISOString().slice(0, 10);
    this.#fold(`quiet:${origin.automationId}:${day}`, 24 * 60 * 60_000, (count) => ({
      kind: "automation",
      by: { kind: "automation", automationId: origin.automationId, name: origin.name },
      title: count === 1 ? "Found nothing new" : `Found nothing new ${count} times today`,
      state: "ended",
      ...(count === 1 ? {} : { count }),
    }));
  }

  #piece(piece: PlanPiece): void {
    if (piece.status !== "done" || this.#told.has(`piece:${piece.id}`)) return;
    if (piece.endedAt === undefined || Date.parse(piece.endedAt) < this.#startedAt) return;
    this.#told.add(`piece:${piece.id}`);
    const goal = this.#store.getTask(piece.taskId);
    if (goal === undefined) return;
    const top = topSession(goal, this.#store.listSessions(goal.id));
    const department =
      piece.departmentId === undefined ? undefined : this.#store.getDepartment(piece.departmentId);
    const who = department?.name ?? "A department";
    const goalName = taskName(goal);
    this.#fold(`parts:${goal.id}:${piece.departmentId ?? ""}`, FOLD_MS, (count) => ({
      kind: "milestone",
      by: top === undefined ? { kind: "app" } : { kind: "agent", agentId: top.agentId },
      title: clip(
        count === 1
          ? `${who} finished "${piece.title}" for "${goalName}"`
          : `${who} finished ${count} parts of "${goalName}"`,
        FEED_TITLE_CHARS,
      ),
      taskId: goal.id,
      ...(piece.departmentId === undefined ? {} : { departmentId: piece.departmentId }),
      state: "ended",
      ...(count === 1 ? {} : { count }),
    }));
  }

  #milestone(milestone: MilestoneRecord): void {
    if (milestone.status !== "met" || this.#told.has(`milestone:${milestone.id}`)) return;
    this.#told.add(`milestone:${milestone.id}`);
    const task = this.#store.getTask(milestone.taskId);
    if (task === undefined) return;
    const owner = task.parentTaskId === undefined ? task : this.#store.getTask(task.parentTaskId);
    if (owner === undefined) return;
    const agentId =
      milestone.reportedBy ?? topSession(task, this.#store.listSessions(task.id))?.agentId;
    this.#fold(`milestones:${owner.id}`, FOLD_MS, (count) => ({
      kind: "milestone",
      by: agentId === undefined ? { kind: "app" } : { kind: "agent", agentId },
      title: clip(
        count === 1
          ? `Milestone met: ${milestone.outcome}`
          : `${count} milestones met in "${taskName(owner)}"`,
        FEED_TITLE_CHARS,
      ),
      taskId: owner.id,
      ...this.#department(task, agentId),
      state: "ended",
      ...(count === 1 ? {} : { count }),
    }));
  }

  // One post for repeats close together: the first is written, later ones raise its count.
  #fold(foldKey: string, within: number, draftFor: (count: number) => PostDraft): void {
    const latest = this.#store.feed.latestFold(foldKey, Date.now() - within);
    if (latest === undefined) {
      this.#store.feed.create(draftFor(1), { foldKey });
      return;
    }
    this.#store.feed.update(latest, draftFor((latest.count ?? 1) + 1), { rise: true });
  }

  #department(task: TaskRecord, agentId: string | undefined): { departmentId?: string } {
    const departmentId =
      task.departmentId ??
      (agentId === undefined ? undefined : this.#store.getAgent(agentId)?.departmentId);
    return departmentId === undefined ? {} : { departmentId };
  }
}
