import {
  type Account,
  type AccountLimits,
  defaultAccountId,
  type SessionOptions,
  type UsageLimit,
} from "@office-town/contract";

// Amber from 70% used, red from 90% (owner, 2026-10-11).
export type Tone = "calm" | "near" | "high";

export function toneOf(usedFraction: number): Tone {
  if (usedFraction >= 0.9) return "high";
  if (usedFraction >= 0.7) return "near";
  return "calm";
}

export const percent = (usedFraction: number) => `${Math.round(usedFraction * 100)}%`;

const WINDOWS: Record<string, { label: string; hours?: number }> = {
  five_hour: { label: "5-hour", hours: 5 },
  seven_day: { label: "Weekly", hours: 7 * 24 },
  seven_day_opus: { label: "Weekly · Opus", hours: 7 * 24 },
  seven_day_sonnet: { label: "Weekly · Sonnet", hours: 7 * 24 },
};

export function windowLabel(limit: UsageLimit): string {
  const known = WINDOWS[limit.id]?.label;
  return known ?? `${limit.label.charAt(0).toUpperCase()}${limit.label.slice(1)}`;
}

// A window that has reset since it was reported starts again from nothing.
export function currentLimits(limits: AccountLimits | undefined, now = Date.now()): UsageLimit[] {
  return (limits?.limits ?? []).map((limit) =>
    limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= now
      ? { ...limit, usedFraction: 0 }
      : limit,
  );
}

export function fullest(
  limits: AccountLimits | undefined,
  now = Date.now(),
): UsageLimit | undefined {
  return currentLimits(limits, now).toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
}

export interface Pace {
  // How far through the window time is, from 0 to 1.
  elapsed: number;
  // When it runs out at this rate, if before the reset.
  runsOutAt?: number;
}

// Only for windows of a known length, once a little of it has passed.
export function paceOf(limit: UsageLimit, now = Date.now()): Pace | undefined {
  const hours = WINDOWS[limit.id]?.hours;
  if (hours === undefined || limit.resetsAt === undefined) return undefined;
  const length = hours * 3600_000;
  const resetsAt = Date.parse(limit.resetsAt);
  const elapsed = 1 - (resetsAt - now) / length;
  if (elapsed < 0.03 || elapsed > 1 || limit.usedFraction >= 1)
    return { elapsed: Math.max(0, elapsed) };
  const perMs = limit.usedFraction / (elapsed * length);
  const runsOutAt = perMs === 0 ? Number.POSITIVE_INFINITY : now + (1 - limit.usedFraction) / perMs;
  return runsOutAt < resetsAt ? { elapsed, runsOutAt } : { elapsed };
}

// A session from before accounts ran on its harness's default login (D-61).
export function sessionAccountId(options: SessionOptions): string {
  return options.accountId ?? defaultAccountId(options.harness, options.environment);
}

export function accountName(
  accounts: readonly Account[],
  harnessName: string,
  accountId: string,
): string {
  const account = accounts.find((known) => known.id === accountId);
  return `${harnessName} · ${account?.name ?? "Default"}`;
}

// The account Automatic would pick now: the most room, the default login first on a tie.
export function roomiest(
  accounts: readonly Account[],
  limits: Record<string, AccountLimits>,
): Account | undefined {
  const room = (account: Account) => fullest(limits[account.id])?.usedFraction ?? 0;
  return accounts
    .filter((account) => account.signedIn !== false)
    .reduce<Account | undefined>(
      (best, account) => (best === undefined || room(account) < room(best) ? account : best),
      undefined,
    );
}

export function sameEnvironment(a: Account["environment"], b: Account["environment"]): boolean {
  return a.kind === b.kind && (a.kind === "native" || (b.kind === "wsl" && a.distro === b.distro));
}

// "4:52 PM" today, "Thu 9:00 AM" within a week, else a date.
export function clock(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  if (at - now < 6 * 24 * 3600_000) {
    return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// "in 1 h 12 min".
export function inTime(at: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((at - now) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h ${minutes % 60} min`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}
