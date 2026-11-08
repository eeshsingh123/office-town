import {
  type Change,
  defaultAccountId,
  type EnvironmentSpec,
  type HarnessStatus,
} from "@office-town/contract";
import { listHarnesses, readHarnessStatus } from "@office-town/harness";
import { rememberedSignIns } from "../accounts/accounts.ts";
import type { Store } from "../store/store.ts";

type StatusListener = (change: Change) => void;

const NATIVE = { kind: "native" } as const;

// A CLI that cannot say whether it is signed in counts as signed in once the app saw its default
// login sign in, and as not signed in before, where it signs in through the browser.
export function withSeenSignIn(
  store: Store,
  status: HarnessStatus,
  environment: EnvironmentSpec,
): HarnessStatus {
  if (!status.installed || status.signedIn !== undefined) return status;
  const seen = rememberedSignIns(store).includes(defaultAccountId(status.harness, environment));
  if (seen) return { ...status, signedIn: true };
  const signIn = listHarnesses().find(({ harness }) => harness === status.harness)?.signIn;
  return signIn === "browser" ? { ...status, signedIn: false } : status;
}

export function reportFailedCheck(error: unknown): void {
  process.stderr.write(`Could not check the providers: ${String(error)}\n`);
}

// Reading every provider starts each CLI and takes up to ten seconds, so a page gets the last
// result at once and the fresh one on the event stream (D-93).
export class HarnessStatuses {
  readonly #store: Store;
  readonly #listeners = new Set<StatusListener>();
  #last: HarnessStatus[] | undefined;
  #reading: Promise<HarnessStatus[]> | undefined;
  #stopped = false;

  constructor(store: Store) {
    this.#store = store;
  }

  // Shares a read in flight.
  check(): Promise<HarnessStatus[]> {
    this.#reading ??= Promise.all(
      listHarnesses().map(({ harness }) => readHarnessStatus(harness, NATIVE)),
    )
      .then((statuses) => {
        // Queries refused while the core stops read as not installed, and the store is closed.
        if (this.#stopped) return statuses;
        this.#last = statuses;
        const change: Change = { type: "harnesses", statuses: this.#shown(statuses) };
        for (const listener of this.#listeners) listener(change);
        return statuses;
      })
      .finally(() => {
        this.#reading = undefined;
      });
    return this.#reading;
  }

  // The first ask waits for the read. A fresh ask waits for one that starts after it, as a read
  // already running may have begun before an install ended.
  async read({ fresh }: { fresh: boolean }): Promise<HarnessStatus[]> {
    if (fresh) await this.#reading?.catch(() => undefined);
    const reading = this.check();
    if (fresh || this.#last === undefined) return this.#shown(await reading);
    reading.catch(reportFailedCheck);
    return this.#shown(this.#last);
  }

  subscribe(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  stop(): void {
    this.#stopped = true;
  }

  #shown(statuses: HarnessStatus[]): HarnessStatus[] {
    return statuses.map((status) => withSeenSignIn(this.#store, status, NATIVE));
  }
}
