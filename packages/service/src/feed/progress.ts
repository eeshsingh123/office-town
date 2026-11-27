import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import {
  type DelegationRecord,
  FEED_BODY_CHARS,
  FEED_TITLE_CHARS,
  type MilestoneRecord,
  type PlanPiece,
  type ProgressChart,
  type ProgressUpdate,
  progressChartSchema,
  type SessionEvent,
} from "@office-town/contract";
import { z } from "zod";
import { isChiefCaller, isChiefTask } from "../chief/chief.ts";
import { ownsGoal } from "../goal/record.ts";
import { redact } from "../notify/redact.ts";
import { hostPathOf, rootOf, taskRoots } from "../outputs/paths.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { draftOf } from "../store/feed-store.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { clip, taskKey } from "./projector.ts";

// D-141: at most one update a task every 30 minutes, and only after something new happened.
export const UPDATE_GAP_MS = 30 * 60_000;
const MOST_PICTURE_BYTES = 2 * 1024 * 1024;
const PICTURE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const NAMED = 80;

const NUDGE = "If this is worth showing the user, post a progress update with post_progress.";

export const updatesOn = (store: Store, taskId: string) => store.getTask(taskId)?.updates === true;

// Only the agent that owns a task's Feed card posts on it: a solo agent, a department's lead, or
// the chief on its goal. A department's piece of a goal reports to the chief instead.
export function ownsCard(store: Store, caller: Caller): boolean {
  const task = store.getTask(caller.taskId);
  if (task === undefined || task.parentTaskId !== undefined) return false;
  if (task.origin?.kind === "check") return false;
  if (isChiefTask(store, task.id)) return isChiefCaller(store, caller);
  return ownsGoal(store, caller);
}

const updatesDue = (store: Store, taskId: string, now = Date.now()) => {
  const last = store.feed.latestUpdateAt(taskId);
  return last === undefined || now - last >= UPDATE_GAP_MS;
};

// One line on a result the card's owner already gets, only while an update would be taken.
export function progressNudge(store: Store, taskId: string): string {
  const task = store.getTask(taskId);
  if (task?.updates !== true || task.parentTaskId !== undefined) return "";
  return updatesDue(store, taskId) ? `\n\n${NUDGE}` : "";
}

const quoted = (text: string) => `"${clip(text.trim(), NAMED)}"`;

// What earns a task its next update, in the words its card shows: a milestone reported, a part,
// piece or plan step finished, or the chief's plan approved.
export class ProgressMarks {
  readonly #store: Store;
  readonly #told = new Set<string>();
  // Plan steps done by session, so only a newly finished one counts.
  readonly #steps = new Map<string, number>();

  constructor(store: Store, registry: SessionRegistry) {
    this.#store = store;
    store.subscribe((change) => {
      if (change.type === "milestone") this.#milestone(change.milestone);
      if (change.type === "delegation") this.#part(change.delegation);
      if (change.type === "piece") this.#piece(change.piece);
    });
    registry.subscribe(({ event }) => this.#heard(event));
  }

  #mark(taskId: string, after: string): void {
    const task = this.#store.getTask(taskId);
    const owner = task?.parentTaskId ?? taskId;
    if (!updatesOn(this.#store, owner)) return;
    this.#store.feed.setMark(owner, clip(after, FEED_TITLE_CHARS));
  }

  #once(key: string): boolean {
    if (this.#told.has(key)) return false;
    this.#told.add(key);
    return true;
  }

  #milestone(milestone: MilestoneRecord): void {
    if (milestone.status === "not_started") return;
    if (!this.#once(`milestone:${milestone.id}:${milestone.status}`)) return;
    const outcome = quoted(milestone.outcome);
    this.#mark(
      milestone.taskId,
      milestone.status === "met" ? `After ${outcome} was met` : `After ${outcome} was checked`,
    );
  }

  #part(part: DelegationRecord): void {
    if (part.status !== "done" || !this.#once(`part:${part.id}`)) return;
    const name = this.#store.getAgent(part.workerAgentId)?.name ?? "A worker";
    const what = part.title === undefined ? "a part" : quoted(part.title);
    this.#mark(part.taskId, `After ${name} finished ${what}`);
  }

  #piece(piece: PlanPiece): void {
    if (piece.status !== "done" || !this.#once(`piece:${piece.id}`)) return;
    const department =
      piece.departmentId === undefined ? undefined : this.#store.getDepartment(piece.departmentId);
    this.#mark(
      piece.taskId,
      `After ${department?.name ?? "A department"} finished ${quoted(piece.title)}`,
    );
  }

  #heard(event: SessionEvent): void {
    if (event.type !== "plan.updated" && event.type !== "plan.resolved") return;
    const session = this.#store.getSession(event.sessionId);
    if (session === undefined) return;
    const caller = { sessionId: session.id, agentId: session.agentId, taskId: session.taskId };
    if (!updatesOn(this.#store, session.taskId) || !ownsCard(this.#store, caller)) return;
    if (event.type === "plan.resolved") {
      if (event.payload.outcome === "approved" || event.payload.outcome === "revised") {
        this.#mark(session.taskId, "After the plan was approved");
      }
      return;
    }
    const done = event.payload.steps.filter((step) => step.status === "completed").length;
    const before = this.#steps.get(session.id) ?? 0;
    this.#steps.set(session.id, done);
    if (done > before) this.#mark(session.taskId, `After step ${done} finished`);
  }
}

const hidden = (text: string, most: number) => clip(redact(text), most);

// Agent text has secrets hidden (D-138), labels included.
function redactChart(chart: ProgressChart): ProgressChart {
  const hide =
    (most: number) =>
    <T extends { label: string; shown?: string | undefined }>(item: T): T => ({
      ...item,
      label: hidden(item.label, most),
      ...(item.shown === undefined ? {} : { shown: hidden(item.shown, 24) }),
    });
  if (chart.kind === "numbers") {
    return {
      kind: "numbers",
      items: chart.items.map(({ label, value, from }) => ({
        label: hidden(label, 40),
        value: hidden(value, 24),
        ...(from === undefined ? {} : { from: hidden(from, 24) }),
      })),
    };
  }
  const caption = chart.caption === undefined ? {} : { caption: hidden(chart.caption, 80) };
  return chart.kind === "bars"
    ? { ...chart, ...caption, items: chart.items.map(hide(40)) }
    : { ...chart, ...caption, points: chart.points.map(hide(24)) };
}

// A picture from the task's own folders, kept in the store so it outlives the file.
async function keepPicture(
  store: Store,
  caller: Caller,
  path: string,
): Promise<{ id: string; name: string; type: string; bytes: Uint8Array }> {
  const session = store.getSession(caller.sessionId);
  const file = session === undefined ? undefined : hostPathOf(session, path);
  if (file === undefined || rootOf(taskRoots(store, caller.taskId), file) === undefined) {
    throw new ToolError("That picture is outside the folders you work in. Move it there first.");
  }
  const type = PICTURE_TYPES[extname(file).toLowerCase()];
  if (type === undefined) throw new ToolError("A picture must be a PNG, JPEG, GIF or WebP file.");
  const found = await stat(file).catch(() => undefined);
  if (found === undefined || !found.isFile()) throw new ToolError(`No file at ${path}.`);
  if (found.size > MOST_PICTURE_BYTES) {
    throw new ToolError("That picture is over 2 MB. Show a smaller one.");
  }
  const name = file.split(/[\\/]/).at(-1) ?? "picture";
  return { id: randomUUID(), name, type, bytes: await readFile(file) };
}

// The card's owner shows how the task is going, in place on its Feed card (D-141).
export function postProgress(store: Store) {
  return defineTool({
    name: "post_progress",
    description:
      "Show the user how this task is going, on its card in Office Town's Feed: what you found " +
      "and what is next, after something real happened, such as a milestone met or a part or " +
      "step done. The app refuses an update less than 30 minutes after the last one or with " +
      "nothing new since. Never repeat milestone, part or step counts, which the app shows " +
      "itself, and never ask for a decision here: use ask_user for that.",
    input: z.object({
      title: z
        .string()
        .trim()
        .min(1)
        .max(FEED_TITLE_CHARS)
        .describe('Where things stand, in one plain line, such as "The page loads in 0.9 s now".'),
      detail: z
        .string()
        .trim()
        .min(1)
        .max(FEED_BODY_CHARS)
        .optional()
        .describe("A few short markdown lines: what you found and what comes next."),
      chart: progressChartSchema
        .optional()
        .describe(
          "Numbers you already have, drawn by the app: numbers (up to 4 values, each with what it was before), or bars or line (2 to 12 labelled values).",
        ),
      picture: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A picture you already made, such as a screenshot, in your work folder: PNG, JPEG, GIF or WebP up to 2 MB. Give a chart or a picture, not both.",
        ),
    }),
    offeredTo: (caller) => updatesOn(store, caller.taskId) && ownsCard(store, caller),
    call: async ({ title, detail, chart, picture }, caller) => {
      // Turned off mid-task, it refuses at once (D-141).
      if (!updatesOn(store, caller.taskId)) {
        throw new ToolError("Not posted: progress updates are off for this task.");
      }
      if (chart !== undefined && picture !== undefined) {
        throw new ToolError("Give a chart or a picture, not both.");
      }
      const card = store.feed.byKey(taskKey(caller.taskId));
      if (card?.kind !== "living") {
        throw new ToolError("Your task has no card at work in Feed now. Put this in your result.");
      }
      const now = Date.now();
      const last = store.feed.latestUpdateAt(caller.taskId);
      if (!updatesDue(store, caller.taskId, now)) {
        const minutes = Math.max(1, Math.round((now - (last ?? now)) / 60_000));
        throw new ToolError(
          `Not posted: updates are at least 30 minutes apart, and your last was ${minutes} minutes ago.`,
        );
      }
      const mark = store.feed.markOf(caller.taskId);
      if (mark === undefined || (last !== undefined && mark.at <= last)) {
        throw new ToolError(
          "Not posted: nothing new since your last update. Post after a milestone, part or step is done.",
        );
      }
      const image = picture === undefined ? undefined : await keepPicture(store, caller, picture);
      const update: ProgressUpdate = {
        id: randomUUID(),
        agentId: caller.agentId,
        title: clip(redact(title), FEED_TITLE_CHARS),
        ...(detail === undefined ? {} : { body: clip(redact(detail), FEED_BODY_CHARS) }),
        ...(chart === undefined ? {} : { chart: redactChart(chart) }),
        ...(image === undefined ? {} : { image: { id: image.id, name: image.name } }),
        after: mark.after,
        at: new Date(now).toISOString(),
      };
      store.feed.batch(() => {
        if (image !== undefined) {
          store.feed.addImage(caller.taskId, image.id, image.type, image.bytes);
        }
        store.feed.addUpdate(caller.taskId, update);
        store.feed.update(
          card,
          { ...draftOf(card), update, updates: (card.updates ?? 0) + 1 },
          { rise: true },
        );
      });
      return "Posted on your task's card in Feed.";
    },
  });
}
