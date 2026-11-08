import {
  type Change,
  defaultAccountId,
  type EnvironmentSpec,
  type HarnessStatus,
} from "@office-town/contract";
import { listHarnesses, readHarnessStatus } from "@office-town/harness";
import { rememberedSignIns } from "../accounts/accounts.ts";
import type { Store } from "../store/store.ts";
import type { ReadCatalog } from "../team/catalogs.ts";

type StatusListener = (change: Change) => void;

const NATIVE = { kind: "native" } as const;
// Each provider's chain runs its CLI queries in the two turns the core allows (D-92); two chains
// keep both turns busy while one reads its models.
const CHAINS_AT_ONCE = 2;

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

// Reading a provider starts its CLI, so a page gets what is known at once and each provider's
// fresh status on the event stream as soon as it is read (D-93).
export class HarnessStatuses {
  readonly #store: Store;
  readonly #readCatalog: ReadCatalog;
  readonly #listeners = new Set<StatusListener>();
  readonly #known = new Map<string, HarnessStatus>();
  readonly #reading = new Map<string, Promise<HarnessStatus>>();
  #checking: Promise<HarnessStatus[]> | undefined;
  #stopped = false;

  constructor(store: Store, readCatalog: ReadCatalog) {
    this.#store = store;
    this.#readCatalog = readCatalog;
  }

  // Every provider, the team's first, each read on its own: its models are read right after its
  // status, so a slow provider holds up only itself. Answers once every status is in; a check
  // already running is shared.
  checkAll(): Promise<HarnessStatus[]> {
    if (this.#checking !== undefined) return this.#checking;
    const order = this.#order();
    const found = new Map<string, HarnessStatus>();
    const everyStatus = Promise.withResolvers<HarnessStatus[]>();
    let next = 0;
    let settled = 0;
    const chain = async () => {
      while (next < order.length && !this.#stopped) {
        const harness = order[next] as string;
        next += 1;
        const status = await this.#check(harness).catch((error: unknown) => {
          reportFailedCheck(error);
          return undefined;
        });
        settled += 1;
        if (status !== undefined) found.set(harness, status);
        if (settled === order.length) everyStatus.resolve(this.#listed(order, found));
        // Kept for the launch, so no model picker waits for it (`cachedCatalogs`).
        if (status?.installed) await this.#readCatalog(harness, NATIVE).catch(() => undefined);
      }
    };
    const chains = Promise.all(Array.from({ length: CHAINS_AT_ONCE }, chain));
    this.#checking = everyStatus.promise;
    void chains.finally(() => {
      // Stopped before every status was in; the store may be closed by then.
      everyStatus.resolve(this.#stopped ? [] : this.#listed(order, found));
      this.#checking = undefined;
    });
    return this.#checking;
  }

  // After an install: one read that starts after it, as a read already running may have begun
  // before the install ended.
  async recheck(harness: string): Promise<HarnessStatus> {
    await this.#reading.get(harness)?.catch(() => undefined);
    return this.#shown(await this.#check(harness));
  }

  // What is known now while a check runs; a fresh ask waits for every status.
  async read({ fresh }: { fresh: boolean }): Promise<HarnessStatus[]> {
    const checking = this.checkAll();
    if (fresh) return checking;
    return this.#listed(this.#order(), this.#known);
  }

  subscribe(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  stop(): void {
    this.#stopped = true;
  }

  #check(harness: string): Promise<HarnessStatus> {
    const running = this.#reading.get(harness);
    if (running !== undefined) return running;
    const reading = readHarnessStatus(harness, NATIVE)
      .then((status) => {
        // Queries refused while the core stops read as not installed, and the store is closed.
        if (this.#stopped) return status;
        this.#known.set(harness, status);
        const change: Change = { type: "harness", status: this.#shown(status) };
        for (const listener of this.#listeners) listener(change);
        return status;
      })
      .finally(() => this.#reading.delete(harness));
    this.#reading.set(harness, reading);
    return reading;
  }

  #order(): string[] {
    const used = new Set(this.#store.listStandingAgents().map(({ settings }) => settings.harness));
    const all = listHarnesses().map(({ harness }) => harness);
    return [...all.filter((harness) => used.has(harness)), ...all.filter((one) => !used.has(one))];
  }

  #listed(order: string[], statuses: ReadonlyMap<string, HarnessStatus>): HarnessStatus[] {
    return order.flatMap((harness) => {
      const status = statuses.get(harness);
      return status === undefined ? [] : [this.#shown(status)];
    });
  }

  #shown(status: HarnessStatus): HarnessStatus {
    return withSeenSignIn(this.#store, status, NATIVE);
  }
}
