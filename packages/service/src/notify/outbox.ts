import { setTimeout as delay } from "node:timers/promises";
import type { DestinationKind, DestinationRecord } from "@office-town/contract";
import { readKeys, type Secrets } from "../connectors/secrets.ts";
import type { OutboxRow } from "../store/destinations-store.ts";
import type { Store } from "../store/store.ts";
import { DESTINATIONS } from "./destinations/all.ts";
import {
  type Destination,
  type Outgoing,
  type Place,
  SendError,
} from "./destinations/destination.ts";
import { redact } from "./redact.ts";

// A send that failed for a reason that may pass is tried again after these, then given up.
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
// What waited longer than a day while Office Town was closed is no longer news.
const STALE_MS = 24 * 60 * 60 * 1000;
const STORED_CHARS = 200_000;

// What the outbox keeps for one message, its text already cleaned of secrets.
export interface Queued {
  kind: Outgoing["kind"];
  title: string;
  text: string;
}

export const keysId = (destinationId: string) => `destination:${destinationId}`;

const sentence = (reason: string) => `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

// Where an automation's messages go: every one written under its key before it is sent, so it goes
// out once and a restart sends what waited; one at a time per destination, spaced by its service's
// limit, tried again on a busy service, and a failure told on the run and the destination, never
// failing the run (D-130).
export class Outbox {
  readonly #store: Store;
  readonly secrets: Secrets;
  readonly #bases: Partial<Record<DestinationKind, string>>;
  readonly #lastSent = new Map<string, number>();
  #timer: NodeJS.Timeout | undefined;
  #draining: Promise<void> | undefined;
  #stopped = false;

  constructor(
    store: Store,
    secrets: Secrets,
    bases: Partial<Record<DestinationKind, string>> = {},
  ) {
    this.#store = store;
    this.secrets = secrets;
    this.#bases = bases;
  }

  start(): void {
    const { destinations } = this.#store;
    for (const row of destinations.waitingSince(Date.now() - STALE_MS)) {
      this.#gaveUp(row, "it waited over a day while Office Town was closed");
    }
    destinations.prune();
    this.#arm();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  keysOf(destinationId: string): Record<string, string> {
    return readKeys(this.secrets, keysId(destinationId));
  }

  placeOf(destination: DestinationRecord): Place<DestinationKind> {
    const { kind } = destination.settings;
    const base = this.#bases[kind];
    return {
      settings: destination.settings,
      keys: this.keysOf(destination.id),
      ...(destination.link === undefined ? {} : { link: destination.link }),
      ...(base === undefined ? {} : { base }),
    } as Place<DestinationKind>;
  }

  // Its text is cleaned of secrets before it is stored; a key queued before is not queued again.
  queue(
    destination: DestinationRecord,
    key: string,
    automationId: string,
    runId: string | undefined,
    message: Queued,
  ): void {
    const known = Object.values(this.keysOf(destination.id));
    const clean: Queued = {
      ...message,
      title: redact(message.title, known),
      text: redact(message.text, known).slice(0, STORED_CHARS),
    };
    if (
      this.#store.destinations.queue(
        destination.id,
        key,
        automationId,
        runId,
        JSON.stringify(clean),
      )
    ) {
      this.#arm();
    }
  }

  // Sent at once, outside the outbox; a refusal throws with its plain reason.
  async test(destination: DestinationRecord): Promise<void> {
    const service = serviceOf(destination);
    try {
      await service.send(
        {
          kind: "test",
          title: "Office Town",
          text: "This is a test. Results from your automations will arrive here.",
        },
        this.placeOf(destination),
      );
      this.#store.destinations.setProblem(destination.id, undefined);
    } catch (error) {
      if (!(error instanceof SendError)) throw error;
      this.#store.destinations.setProblem(destination.id, sentence(error.message));
      throw error;
    }
  }

  #arm(): void {
    if (this.#stopped) return;
    clearTimeout(this.#timer);
    const at = this.#store.destinations.earliestDue();
    if (at === undefined) return;
    this.#timer = setTimeout(() => this.#drain(), Math.max(0, at - Date.now()));
    this.#timer.unref();
  }

  #drain(): void {
    if (this.#draining !== undefined) return;
    this.#draining = this.#sendDue()
      .catch((error: unknown) => console.error("Could not send what waited.", error))
      .finally(() => {
        this.#draining = undefined;
        this.#arm();
      });
  }

  async #sendDue(): Promise<void> {
    const due = this.#store.destinations.due(Date.now());
    const byDestination = Map.groupBy(due, (row) => row.destinationId);
    for (const [destinationId, rows] of byDestination) {
      const destination = this.#store.destinations.get(destinationId);
      if (destination === undefined) continue;
      // Alerts due together go as one message, so a burst is one ping (D-124's idea).
      const alerts = rows.filter((row) => parse(row).kind === "alert");
      const batches = [
        ...(alerts.length > 0 ? [alerts] : []),
        ...rows.filter((row) => !alerts.includes(row)).map((row) => [row]),
      ];
      for (const batch of batches) {
        if (this.#stopped) return;
        await this.#waitGap(destination);
        await this.#send(destination, batch);
      }
    }
  }

  async #waitGap(destination: DestinationRecord): Promise<void> {
    const gap = serviceOf(destination).gapMs;
    const since = Date.now() - (this.#lastSent.get(destination.id) ?? 0);
    if (since < gap) await delay(gap - since, undefined, { ref: false });
  }

  async #send(destination: DestinationRecord, rows: OutboxRow[]): Promise<void> {
    const [first] = rows;
    if (first === undefined) return;
    const message = rows.length === 1 ? outgoingOf(parse(first)) : together(rows);
    try {
      await serviceOf(destination).send(message, this.placeOf(destination));
      this.#lastSent.set(destination.id, Date.now());
      for (const row of rows) {
        this.#store.destinations.markSent(row.ref);
        this.#sentFor(row);
      }
      this.#store.destinations.setProblem(destination.id, undefined);
    } catch (error) {
      this.#lastSent.set(destination.id, Date.now());
      const failure =
        error instanceof SendError ? error : new SendError("something went wrong sending it", true);
      if (!(error instanceof SendError)) console.error("A send failed.", error);
      for (const row of rows) this.#failed(row, failure);
    }
  }

  #failed(row: OutboxRow, error: SendError): void {
    const wait = BACKOFF_MS[row.attempts];
    if (error.retry && wait !== undefined) {
      this.#store.destinations.retryAt(row.ref, Date.now() + Math.max(wait, error.afterMs ?? 0));
      return;
    }
    this.#gaveUp(row, error.message);
  }

  // The run says so, the destination shows it, and three in a row show on the automation.
  #gaveUp(row: OutboxRow, reason: string): void {
    const store = this.#store;
    store.destinations.markFailed(row.ref);
    const destination = store.destinations.get(row.destinationId);
    const service = destination === undefined ? "it" : serviceOf(destination).service;
    const problem = `Couldn't send to ${service}: ${reason}.`;
    if (destination !== undefined) store.destinations.setProblem(destination.id, sentence(reason));
    if (row.runId !== null) store.automations.updateRun(row.runId, { sendProblem: problem });
    const automation = store.automations.get(row.automationId);
    if (automation === undefined) return;
    const count = (automation.sendFailures?.count ?? 0) + 1;
    store.automations.setSendFailures(automation.id, { count, reason: problem });
  }

  #sentFor(row: OutboxRow): void {
    const automation = this.#store.automations.get(row.automationId);
    if (automation?.sendFailures !== undefined) {
      this.#store.automations.setSendFailures(automation.id, undefined);
    }
  }
}

export function serviceOf(destination: DestinationRecord): Destination {
  return DESTINATIONS[destination.settings.kind] as Destination;
}

export const parse = (row: OutboxRow) => JSON.parse(row.message) as Queued;

const outgoingOf = ({ kind, title, text }: Queued): Outgoing => ({ kind, title, text });

function together(rows: OutboxRow[]): Outgoing {
  const lines = rows.map((row) => {
    const { title, text } = parse(row);
    return `${title}: ${text}`;
  });
  return {
    kind: "alert",
    title: `${rows.length} alerts from Office Town`,
    text: lines.join("\n"),
  };
}
