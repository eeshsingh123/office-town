import { createHash } from "node:crypto";
import type { SuggestionRule, TaskRecord } from "@office-town/contract";
import { taskName } from "../notify/notifier.ts";
import type { PostDraft } from "../store/feed-store.ts";
import type { Store } from "../store/store.ts";

const DAY = 24 * 60 * 60_000;
// D-139: at most 3 a day, the same request on 3 days in 30, never one suggested twice a month.
const MOST_A_DAY = 3;
const REPEATS = 3;
const LOOK_BACK = 30 * DAY;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Never while something waits on the user, never past the day's count, never a quietened rule.
export function mayFeedSuggest(store: Store, rule: SuggestionRule): boolean {
  const settings = store.readSettings();
  if (settings.suggestions === false) return false;
  const quiet = settings.suggestionsQuietUntil?.[rule];
  if (quiet !== undefined && Date.parse(quiet) > Date.now()) return false;
  if (store.feed.countSince("suggested", Date.now() - DAY) >= MOST_A_DAY) return false;
  return store.listPendingRequests().requests.length === 0;
}

// "Every Monday at 9:00" when every time fell on one weekday, else every day at the last hour.
function scheduleOf(times: readonly number[]): string {
  const last = new Date(times.at(-1) ?? Date.now());
  const time = `${last.getHours()}:00`;
  const days = new Set(times.map((at) => new Date(at).getDay()));
  return days.size === 1 ? `every ${WEEKDAYS[last.getDay()]} at ${time}` : `every day at ${time}`;
}

const promptOf = (task: { kind: string; request: object }) =>
  "prompt" in task.request && typeof task.request.prompt === "string"
    ? task.request.prompt.trim()
    : undefined;

// The same request of the user's own, three times in a month and not yet an automation.
export function suggestRepeat(store: Store, task: TaskRecord): void {
  if (task.parentTaskId !== undefined) return;
  if (task.origin !== undefined && task.origin.kind !== "you") return;
  if (!mayFeedSuggest(store, "repeat")) return;
  const prompt = task.prompt.trim();
  const times = store.feed.sameRequests(task.prompt, Date.now() - LOOK_BACK);
  // On different days: three in one sitting is not a habit worth a schedule.
  const days = new Set(times.map((at) => new Date(at).toDateString()));
  if (days.size < REPEATS) return;
  if (store.automations.list().some((automation) => promptOf(automation.task) === prompt)) return;
  const foldKey = `suggest:repeat:${createHash("sha256").update(prompt).digest("hex").slice(0, 16)}`;
  if (store.feed.latestFold(foldKey, Date.now() - LOOK_BACK) !== undefined) return;
  const when = scheduleOf(times);
  const name = taskName(task);
  const draft: PostDraft = {
    kind: "suggested",
    by: { kind: "app" },
    title: `Run "${name}" ${when}?`,
    body: `As an automation it runs ${when} and posts its result here.`,
    ...(task.departmentId === undefined ? {} : { departmentId: task.departmentId }),
    state: "open",
    suggestion: {
      rule: "repeat",
      why: `You asked for this on ${days.size} different days in the last 30.`,
      open: {
        kind: "automation",
        describe: `${when[0]?.toUpperCase()}${when.slice(1)}: ${prompt}`,
      },
    },
  };
  store.feed.create(draft, { foldKey });
}
