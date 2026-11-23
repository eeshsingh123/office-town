import type {
  AutomationPause,
  AutomationRecord,
  EventSourceConfig,
  EventSourceKind,
} from "@office-town/contract";
import type { SeenEvent } from "../../store/automation-events-store.ts";
import type { TeamContext } from "../../team/members.ts";

// An automation's run that changed a file, as far as the core saw it change.
export interface Writer {
  automationId: string;
  depth: number;
}

export interface SourceContext {
  readonly team: TeamContext;
  readonly automation: AutomationRecord;
  // The source's own place across restarts, such as an ETag or when it last looked.
  state<T>(): T | undefined;
  setState(state: unknown): void;
  // What it found, and how many of them were new. A first look's things are a start point:
  // remembered, never run.
  seen(events: SeenEvent[], options?: { startPoint?: boolean }): number;
  // A look that came back, with how many things were new.
  looked(found: number): void;
  // Stops this source and pauses its automation with the one fix.
  fail(reason: string, fix?: AutomationPause["fix"]): void;
  // Who last changed this file, when an agent did.
  writerOf(path: string): Writer | undefined;
  // An app's pasted keys, read from the credential store when needed (D-67).
  keysOf(connectorId: string): Record<string, string>;
}

// One file per kind, so a new source is a new file and no core edit (D-128). `start` never
// throws; a source in trouble calls `fail`. It returns its stop.
export interface EventSource<Kind extends EventSourceKind = EventSourceKind> {
  readonly kind: Kind;
  start(config: Extract<EventSourceConfig, { kind: Kind }>, context: SourceContext): () => void;
}

export type AnySource = { [Kind in EventSourceKind]: EventSource<Kind> }[EventSourceKind];

const MINUTE_MS = 60_000;
const MOST_BACKOFF_MS = 60 * MINUTE_MS;

// Looks every `everyMs`, at once if the last look is older; after an error, twice as long each
// time up to an hour. A look that fails three times in a row in a way a retry cannot fix should
// call `fail` itself.
export function lookEvery(
  everyMs: number,
  lastAt: number | undefined,
  look: () => Promise<void>,
  onError: (error: unknown, failures: number) => void,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let failures = 0;
  const arm = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(run, Math.max(0, ms));
    timer.unref();
  };
  const run = () => {
    look().then(
      () => {
        failures = 0;
        arm(everyMs);
      },
      (error: unknown) => {
        failures += 1;
        onError(error, failures);
        arm(Math.min(everyMs * 2 ** failures, Math.max(everyMs, MOST_BACKOFF_MS)));
      },
    );
  };
  arm(lastAt === undefined ? 0 : lastAt + everyMs - Date.now());
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// Plain text from a page or feed: tags and entities out, spaces folded, cut to `most` characters.
export function plainText(html: string, most: number): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > most ? `${text.slice(0, most - 1)}…` : text;
}

export const MINUTES = MINUTE_MS;
