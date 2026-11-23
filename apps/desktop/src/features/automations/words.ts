import type {
  AutomationRecord,
  AutomationTask,
  EventSourceConfig,
  RunStatus,
  Schedule,
  Trigger,
} from "@office-town/contract";
import { STATUS_LABELS } from "../tasks/task-list.ts";

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const ordinal = (day: number) => {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};

export function dayText(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "Every weekday at 9:00", in the schedule's own words.
export function scheduleText(schedule: Schedule): string {
  switch (schedule.repeat) {
    case "daily":
      return `Every day at ${schedule.time}`;
    case "weekdays":
      return `Every weekday at ${schedule.time}`;
    case "weekly": {
      const days = [...new Set(schedule.days)].toSorted().map((day) => DAY_NAMES[day] ?? "");
      return days.length === 7
        ? `Every day at ${schedule.time}`
        : `Every ${list(days)} at ${schedule.time}`;
    }
    case "monthly":
      return schedule.day === "last"
        ? `On the last day of every month at ${schedule.time}`
        : `On the ${ordinal(schedule.day)} of every month at ${schedule.time}`;
    case "hours": {
      const every = schedule.every === 1 ? "Every hour" : `Every ${schedule.every} hours`;
      return schedule.until === undefined
        ? `${every} from ${schedule.from}`
        : `${every} from ${schedule.from} to ${schedule.until}`;
    }
    case "once":
      return `Once, on ${dayText(schedule.date)} at ${schedule.time}`;
  }
}

// "every 15 minutes", "every hour", "every 2 hours", "every day".
export function everyText(minutes: number): string {
  if (minutes < 60) return `every ${minutes} minutes`;
  if (minutes === 60) return "every hour";
  if (minutes === 24 * 60) return "every day";
  return `every ${minutes / 60} hours`;
}

// The folder's own name, the last part of its path.
export const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) || path;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const WATCH_NOUNS = { issues: "issue", pulls: "pull request", both: "issue or pull request" };

function sourceText(source: EventSourceConfig): string {
  switch (source.kind) {
    case "folder":
      return `When a file lands in ${folderName(source.path)}`;
    case "check":
      return `Looks ${everyText(source.everyMinutes)} for ${lowerFirst(source.look)}`;
    case "github":
      return `When ${source.repo} gets a new ${WATCH_NOUNS[source.watch]}`;
    case "feed":
      return `When ${new URL(source.url).host} posts something new`;
  }
}

// What one run got, in the source's own words: "3 new files".
export function eventsText(source: EventSourceConfig, count: number): string {
  const [one, many] =
    source.kind === "folder"
      ? ["file", "files"]
      : source.kind === "feed"
        ? ["post", "posts"]
        : source.kind === "check"
          ? ["thing", "things"]
          : source.watch === "pulls"
            ? ["pull request", "pull requests"]
            : source.watch === "issues"
              ? ["issue", "issues"]
              : ["issue or pull request", "issues and pull requests"];
  return count === 1 ? `1 new ${one}` : `${count} new ${many}`;
}

// The When in one line; `names` turns an automation id into its name.
export function whenText(trigger: Trigger, names: (id: string) => string | undefined): string {
  if (trigger.kind === "event") return sourceText(trigger.source);
  if (trigger.kind === "after") {
    const name = names(trigger.automationId) ?? "another automation";
    return trigger.outcome === "done" ? `After ${name} finishes` : `After ${name} ends`;
  }
  const base = scheduleText(trigger.schedule);
  const zone = trigger.timeZone === localZone() ? "" : ` (${trigger.timeZone})`;
  const { ends } = trigger;
  const until =
    ends.kind === "on"
      ? `, until ${dayText(ends.date)}`
      : ends.kind === "after"
        ? `, ${ends.runs} ${ends.runs === 1 ? "run" : "runs"}`
        : "";
  const from =
    trigger.starts === undefined || trigger.schedule.repeat === "once"
      ? ""
      : `, from ${dayText(trigger.starts)}`;
  return `${base}${zone}${from}${until}`;
}

// "Mon 9:00", or "Today 14:00" and "Tomorrow 9:00" when close.
export function runTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = at.toLocaleDateString([], {
    weekday: Math.abs(days) < 7 ? "short" : undefined,
    day: Math.abs(days) < 7 ? undefined : "numeric",
    month: Math.abs(days) < 7 ? undefined : "short",
    year: sameYear ? undefined : "numeric",
  });
  return `${date} ${time}`;
}

export const RUN_LABELS: Record<RunStatus, string> = {
  ...STATUS_LABELS,
  waiting: "Waiting",
  skipped: "Skipped",
};

// One status per automation: what waits on the user first, then what runs, then when next.
export type AutomationState = "paused" | "off" | "needs" | "working" | "waiting" | "on";

export function stateOf(automation: AutomationRecord): AutomationState {
  if (automation.paused !== undefined) return "paused";
  const latest = automation.latestRun?.status;
  if (latest === "needs") return "needs";
  if (latest === "working" || latest === "queued") return "working";
  if (latest === "waiting") return "waiting";
  return automation.enabled ? "on" : "off";
}

export function stateText(automation: AutomationRecord): string {
  switch (stateOf(automation)) {
    case "paused":
      return "Paused";
    case "off":
      return "Off";
    case "needs":
      return "Needs you";
    case "working":
      return "Working";
    case "waiting":
      return "Waiting";
    case "on":
      if (automation.trigger.kind === "event") return "Watching";
      return automation.nextRunAt === undefined
        ? automation.trigger.kind === "after"
          ? "On"
          : "No more runs"
        : `Next ${runTime(automation.nextRunAt)}`;
  }
}

// "chief", "assistant" or the department's id: the same keys the drafter uses.
export const whoKey = (task: AutomationTask) =>
  task.kind === "department" ? task.request.team.departmentId : task.kind;

export const promptOf = (task: AutomationTask) =>
  task.kind === "assistant" ? task.request.prompt : task.request.goal;
