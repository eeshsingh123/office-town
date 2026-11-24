import type { DestinationKind, DestinationSettings, TelegramLink } from "@office-town/contract";

// One message to send, already cleaned of secrets (D-130). Its title is the core's own words; its
// text is the run's result or the ask's words, or the core's own sentence for an alert.
export interface Outgoing {
  kind: "result" | "alert" | "ask" | "test";
  title: string;
  text: string;
}

// What the service said, in plain words for "Couldn't send to Telegram: …". `retry` when trying
// again later may work; `afterMs` when the service said how long to wait.
export class SendError extends Error {
  readonly retry: boolean;
  readonly afterMs: number | undefined;

  constructor(message: string, retry: boolean, afterMs?: number) {
    super(message);
    this.name = "SendError";
    this.retry = retry;
    this.afterMs = afterMs;
  }
}

export interface Place<K extends DestinationKind> {
  settings: Extract<DestinationSettings, { kind: K }>;
  keys: Record<string, string>;
  link?: TelegramLink;
  // The service's address, which a test points at a fake server.
  base?: string;
}

// One service results can go to: a file of its own, so a new one needs no edits to the core.
export interface Destination<K extends DestinationKind = DestinationKind> {
  kind: K;
  // As users read it: "Couldn't send to Slack".
  service: string;
  // The pasted keys it needs, by name; optional ones end with "?".
  keys: readonly string[];
  // The least time between two sends to one place, under the service's own limit.
  gapMs: number;
  send(message: Outgoing, place: Place<K>): Promise<void>;
}

const TIMEOUT_MS = 30_000;

// A pasted webhook address, or the same path on a test's fake server.
export const addressOf = (url: string, base: string | undefined) =>
  base === undefined ? url : `${base}${new URL(url).pathname}`;

// A reply the service gave, or the plain reason it could not be reached.
export async function post(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SendError("it couldn't be reached", true);
  }
}

// Seconds from a Retry-After header, or a body's `retry_after`.
export function retryAfterMs(response: Response, seconds?: number): number | undefined {
  const header = Number(response.headers.get("retry-after"));
  const wait = seconds ?? (Number.isFinite(header) && header > 0 ? header : undefined);
  return wait === undefined ? undefined : Math.ceil(wait * 1000);
}

// Busy or down: try again later. Anything else the service refused stays refused.
export function refused(response: Response, reason: string, seconds?: number): SendError {
  const again = response.status === 429 || response.status === 408 || response.status >= 500;
  return new SendError(
    again ? `${reason} (it was busy)` : reason,
    again,
    retryAfterMs(response, seconds),
  );
}

// Cut at a line or word near the end, never mid-word, with a mark that it was cut.
export function cut(text: string, most: number): string {
  if (text.length <= most) return text;
  const room = text.slice(0, most - 1);
  const at = Math.max(room.lastIndexOf("\n"), room.lastIndexOf(" "));
  return `${room.slice(0, at > most * 0.8 ? at : room.length).trimEnd()}…`;
}

// In pieces of at most `most`, at most `pieces` of them; the last says the rest was cut.
export function split(text: string, most: number, pieces: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest !== "" && parts.length < pieces) {
    const last = parts.length === pieces - 1;
    const part = last ? cut(rest, most) : cut(rest, most).replace(/…$/, "");
    parts.push(part);
    rest = rest.slice(part.length).trimStart();
  }
  return parts;
}

export const fullText = ({ title, text }: Outgoing) =>
  text === "" ? title : `${title}\n\n${text}`;

export const resultFile = (message: Outgoing) =>
  new Blob([`${fullText(message)}\n`], { type: "text/markdown" });
