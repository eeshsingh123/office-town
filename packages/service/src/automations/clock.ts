import type { AutomationRecord, Schedule, Trigger } from "@office-town/contract";
import { Cron } from "croner";

type ScheduleTrigger = Extract<Trigger, { kind: "schedule" }>;

// A timer that fires later than this means the computer slept or its clock moved.
export const LATE_MS = 2 * 60_000;
// setTimeout's longest wait; a later run re-arms on the way.
const LONGEST_TIMER_MS = 2 ** 31 - 1;
// Enough to count missed runs without ever listing years of them.
const COUNT_UP_TO = 1000;

const hourMinute = (time: string) => {
  const [hour = "0", minute = "0"] = time.split(":");
  return { hour: Number(hour), minute: Number(minute) };
};

const minutesOf = (time: string) => {
  const { hour, minute } = hourMinute(time);
  return hour * 60 + minute;
};

const DAY_MINUTES = 24 * 60;

// The hours of each day it runs, from `from` to `until`; an `until` earlier than `from` runs past
// midnight, and none is later than `until`.
function hoursOf({ every, from, until }: Extract<Schedule, { repeat: "hours" }>): number[] {
  const first = minutesOf(from);
  let last = until === undefined ? DAY_MINUTES - 1 : minutesOf(until);
  if (last < first) last += DAY_MINUTES;
  const hours = new Set<number>();
  for (let at = first; at <= last; at += every * 60) hours.add(Math.floor(at / 60) % 24);
  return [...hours].toSorted((a, b) => a - b);
}

// Each preset as a cron rule, or a wall-clock date for Once.
export function patternOf(schedule: Schedule): string {
  if (schedule.repeat === "once") return `${schedule.date}T${schedule.time}:00`;
  if (schedule.repeat === "hours") {
    return `${hourMinute(schedule.from).minute} ${hoursOf(schedule).join(",")} * * *`;
  }
  const { hour, minute } = hourMinute(schedule.time);
  switch (schedule.repeat) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${[...new Set(schedule.days)].toSorted().join(",")}`;
    case "monthly":
      return `${minute} ${hour} ${schedule.day === "last" ? "L" : schedule.day} * *`;
  }
}

function cronOf(trigger: ScheduleTrigger): Cron {
  const { ends } = trigger;
  return new Cron(patternOf(trigger.schedule), {
    paused: true,
    timezone: trigger.timeZone,
    ...(trigger.starts === undefined ? {} : { startAt: `${trigger.starts}T00:00:00` }),
    // Ends on that day, so its runs that day still happen.
    ...(ends.kind === "on" ? { stopAt: `${ends.date}T23:59:59` } : {}),
  });
}

// The next `count` run times after `after`. Ends after N runs counts the schedule's own times
// from `since`, as a calendar does, whether each ran or not. Daylight saving follows croner: a
// time that does not exist runs at the first valid time, one that happens twice once.
export function nextRuns(
  trigger: ScheduleTrigger,
  after: Date,
  count: number,
  since: Date = after,
): Date[] {
  const cron = cronOf(trigger);
  const next = cron.nextRuns(count, after);
  if (trigger.ends.kind !== "after") return next;
  const last = cron.nextRuns(trigger.ends.runs, new Date(since.getTime() - 1)).at(-1);
  return last === undefined ? [] : next.filter((at) => at <= last);
}

export interface Missed {
  // The latest slot that passed, and how many passed in all (at most COUNT_UP_TO).
  latest: Date;
  count: number;
}

// The slots from `from` up to `now`, counted once, never enumerated past a cap.
export function missedSince(trigger: ScheduleTrigger, from: Date, now: Date): Missed | undefined {
  const cron = cronOf(trigger);
  let count = 0;
  let latest: Date | undefined;
  let cursor: Date | null = new Date(from.getTime() - 1);
  while (count < COUNT_UP_TO) {
    cursor = cron.nextRun(cursor);
    if (cursor === null || cursor > now) break;
    latest = cursor;
    count += 1;
  }
  return latest === undefined ? undefined : { latest, count };
}

// One run if the latest missed slot is within the catch-up window, else none (D-125).
export function catchUp(missed: Missed, catchUpHours: number, now: Date): boolean {
  return now.getTime() - missed.latest.getTime() <= catchUpHours * 60 * 60 * 1000;
}

export type ClockTick = (due: AutomationRecord[]) => void;

// One timer to the earliest next run, never one per automation.
export class Clock {
  readonly #earliest: () => number | undefined;
  readonly #due: (now: number) => AutomationRecord[];
  readonly #tick: ClockTick;
  #timer: NodeJS.Timeout | undefined;
  #armedFor: number | undefined;
  #stopped = false;

  constructor(
    earliest: () => number | undefined,
    due: (now: number) => AutomationRecord[],
    tick: ClockTick,
  ) {
    this.#earliest = earliest;
    this.#due = due;
    this.#tick = tick;
  }

  arm(): void {
    if (this.#stopped) return;
    const at = this.#earliest();
    if (at === this.#armedFor && this.#timer !== undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#armedFor = at;
    if (at === undefined) return;
    const wait = Math.min(Math.max(0, at - Date.now()), LONGEST_TIMER_MS);
    this.#timer = setTimeout(() => this.#fire(), wait);
    this.#timer.unref();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  // Each due automation tells by its own slot whether this fired late.
  #fire(): void {
    this.#timer = undefined;
    this.#armedFor = undefined;
    const due = this.#due(Date.now());
    if (due.length > 0) this.#tick(due);
    this.arm();
  }
}
