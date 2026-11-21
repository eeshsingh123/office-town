import { setTimeout as delay } from "node:timers/promises";
import type { QueuedStart, QueueEntry } from "@office-town/contract";
import type { SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { waitFor } from "./admission.ts";

const MAX_WAITING = 100;
export const LONGEST_WAIT_HOURS = 12;
const STARTING_AT_ONCE = 2;
// Each process start blocks the core's thread on Windows, so starts are spaced (D-92).
const START_GAP_MS = 1_000;
const TICK_MS = 60_000;

export type Start = (what: QueuedStart) => Promise<void>;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The one door for every start no person typed (D-121). Each start is written before it runs, and
// one pass at a time decides what can start, so two wake-ups never start the same entry twice.
export class AdmissionQueue {
  readonly #store: Store;
  readonly #launch: string;
  readonly #start: Start;
  readonly #timer: NodeJS.Timeout;
  // The tasks this queue is starting, two at a time.
  readonly #starting = new Set<string>();
  #advancing = false;
  #again = false;

  constructor(store: Store, registry: SessionRegistry, launch: string, start: Start) {
    this.#store = store;
    this.#launch = launch;
    this.#start = start;
    store.queue.dropOtherLaunches(launch);
    // A task that ended frees its department; new limits may give an account room.
    store.subscribe((change) => {
      if (change.type === "task" || change.type === "limits") this.#wake();
    });
    // Its own starts are no longer waiting, so only a start by hand cancels an entry.
    registry.subscribe(({ event }) => {
      if (event.type !== "session.started") return;
      const taskId = store.getSession(event.sessionId)?.taskId;
      if (taskId !== undefined) this.cancel(taskId, "You continued it yourself.");
    });
    this.#timer = setInterval(() => this.#wake(), TICK_MS);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  // This launch's entry for it, if any: a start never runs twice in one launch.
  entryOf(what: QueuedStart): QueueEntry | undefined {
    return this.#store.queue.ofTask(what, this.#launch);
  }

  add(what: QueuedStart): QueueEntry {
    const { queue } = this.#store;
    const waiting = queue.waiting();
    const oldest = waiting[0];
    if (waiting.length >= MAX_WAITING && oldest !== undefined && this.entryOf(what) === undefined) {
      queue.update(oldest.id, "skipped", "Too many were waiting, so it was not resumed.");
    }
    const waitUntil = new Date(Date.now() + LONGEST_WAIT_HOURS * 60 * 60 * 1000);
    const entry = queue.add(what, this.#launch, waitUntil);
    this.#wake();
    return entry;
  }

  cancel(taskId: string, reason: string): void {
    const entry = this.entryOf({ kind: "resume", taskId });
    if (entry?.state === "waiting") this.#store.queue.update(entry.id, "cancelled", reason);
  }

  #wake(): void {
    if (this.#advancing) {
      this.#again = true;
      return;
    }
    if (this.#store.queue.waiting().length === 0) return;
    this.#advancing = true;
    void this.#advance().finally(() => {
      this.#advancing = false;
    });
  }

  async #advance(): Promise<void> {
    do {
      this.#again = false;
      try {
        await this.#startWhatCan();
      } catch (error) {
        console.error("The queue could not start its waiting work.", error);
      }
    } while (this.#again);
  }

  async #startWhatCan(): Promise<void> {
    const { queue } = this.#store;
    for (const listed of queue.waiting()) {
      // Read again: the gap between starts leaves time to continue or delete it by hand.
      const entry = this.entryOf(listed.what);
      if (entry?.state !== "waiting") continue;
      const wait = waitFor(this.#store, entry.taskId, LONGEST_WAIT_HOURS);
      if (wait !== undefined && Date.now() > Date.parse(entry.waitUntil)) {
        queue.update(entry.id, "skipped", wait.gaveUp);
        continue;
      }
      if (wait !== undefined) {
        queue.update(entry.id, "waiting", wait.reason);
        continue;
      }
      if (this.#starting.size >= STARTING_AT_ONCE) {
        queue.update(entry.id, "waiting", "Waiting: other work is starting first");
        continue;
      }
      queue.update(entry.id, "started", undefined);
      this.#starting.add(entry.taskId);
      this.#start(entry.what)
        .catch((error: unknown) => {
          queue.update(entry.id, "skipped", `It could not be resumed: ${errorMessage(error)}`);
        })
        .finally(() => {
          this.#starting.delete(entry.taskId);
          this.#wake();
        });
      await delay(START_GAP_MS, undefined, { ref: false });
    }
  }
}
