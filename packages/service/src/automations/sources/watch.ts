import type { AutomationRecord, EventSourceKind } from "@office-town/contract";
import type { TeamContext } from "../../team/members.ts";
import type { Runner } from "../runner.ts";
import type { AnySource, SourceContext, Writer } from "./source.ts";

const HOUR_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * HOUR_MS;

interface Running {
  key: string;
  stop: () => void;
}

// What a source keeps, tied to the source it was kept for, so an edit starts afresh.
interface Kept {
  source: string;
  state: unknown;
}

export interface WatchNeeds {
  writerOf(path: string): Writer | undefined;
  keysOf(connectorId: string): Record<string, string>;
}

const keyOf = (automation: AutomationRecord) =>
  automation.trigger.kind === "event" ? JSON.stringify(automation.trigger.source) : undefined;

const watched = (automation: AutomationRecord | undefined) =>
  automation?.enabled === true &&
  automation.paused === undefined &&
  automation.trigger.kind === "event";

// Starts each automation's source while it is on, and stops it when it is off, paused, edited or
// deleted (D-128). A source in trouble pauses only its own automation.
export class EventWatch {
  readonly #team: TeamContext;
  readonly #runner: Runner;
  readonly #sources: Map<EventSourceKind, AnySource>;
  readonly #needs: WatchNeeds;
  readonly #running = new Map<string, Running>();
  #prune: NodeJS.Timeout | undefined;

  constructor(team: TeamContext, runner: Runner, sources: AnySource[], needs: WatchNeeds) {
    this.#team = team;
    this.#runner = runner;
    this.#sources = new Map(sources.map((source) => [source.kind, source]));
    this.#needs = needs;
  }

  start(): void {
    const { store } = this.#team;
    store.subscribe((change) => {
      if (change.type === "automation") this.#sync(change.automation.id);
      if (change.type === "automation.removed") this.#sync(change.automationId);
    });
    for (const automation of store.automations.list()) this.#sync(automation.id);
    store.automationEvents.prune();
    this.#prune = setInterval(() => store.automationEvents.prune(), PRUNE_EVERY_MS);
    this.#prune.unref();
  }

  stop(): void {
    clearInterval(this.#prune);
    for (const { stop } of this.#running.values()) stop();
    this.#running.clear();
  }

  #sync(id: string): void {
    const automation = this.#team.store.automations.get(id);
    const key = automation === undefined ? undefined : keyOf(automation);
    const running = this.#running.get(id);
    if (running !== undefined && (!watched(automation) || running.key !== key)) {
      running.stop();
      this.#running.delete(id);
    }
    if (automation === undefined || key === undefined || !watched(automation)) return;
    if (this.#running.has(id) || automation.trigger.kind !== "event") return;
    const { source } = automation.trigger;
    const kind = this.#sources.get(source.kind);
    if (kind === undefined) return;
    let stopped = false;
    const context = this.#contextOf(automation, key, () => stopped);
    const stop = kind.start(source as never, context);
    this.#running.set(id, {
      key,
      stop: () => {
        stopped = true;
        stop();
      },
    });
    // What it saw before a close, a pause or turning it off goes now.
    this.#runner.fireEvents(id);
  }

  #contextOf(automation: AutomationRecord, key: string, stopped: () => boolean): SourceContext {
    const { store } = this.#team;
    const { id } = automation;
    const startedAt = Date.now();
    return {
      team: this.#team,
      automation,
      state: <T>() => {
        const kept = store.automationEvents.state<Kept>(id);
        return kept?.source === key ? (kept.state as T) : undefined;
      },
      setState: (state) => {
        if (stopped()) return;
        store.automationEvents.setState(id, { source: key, state } satisfies Kept);
      },
      seen: (events, options) => {
        if (stopped()) return 0;
        if (options?.startPoint === true) {
          store.automationEvents.take(id, events, true);
          return 0;
        }
        // Things from before this start, older than its catch-up window, are only counted.
        const hours = store.automations.get(id)?.rules.catchUpHours ?? 0;
        const cutoff = startedAt - hours * HOUR_MS;
        const late = events.filter((event) => event.at < cutoff);
        const fresh = events.filter((event) => event.at >= cutoff);
        const missed = store.automationEvents.take(id, late, true);
        if (missed > 0) this.#runner.missedEvents(id, missed);
        const added = store.automationEvents.take(id, fresh);
        if (added > 0) this.#runner.fireEvents(id);
        return added;
      },
      looked: (found) => {
        if (stopped()) return;
        store.automations.setLastLook(id, { at: new Date().toISOString(), found });
      },
      fail: (reason, fix = "edit") => {
        if (stopped()) return;
        this.#running.get(id)?.stop();
        this.#running.delete(id);
        const current = store.automations.get(id);
        if (current !== undefined) this.#runner.pause(current, reason, fix);
      },
      writerOf: (path) => this.#needs.writerOf(path),
      keysOf: (connectorId) => this.#needs.keysOf(connectorId),
    };
  }
}
