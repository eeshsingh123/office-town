import { basename } from "node:path";
import type { SessionEvent } from "@office-town/contract";
import { canonicalPath } from "../autonomy/policy.ts";
import { hostPathOf } from "../outputs/paths.ts";
import type { TeamContext } from "./members.ts";

const WRITES = new Set(["edit", "delete", "move"]);
// Plenty for what agents work on at once; the oldest change is forgotten first.
const CHANGES_KEPT = 5_000;

interface Change {
  sessionId: string;
  at: number;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// A workspace is live and shared (D-127). When an agent changes a file another agent changed after
// it last read it, both hear so at once and their traces show it. Nothing is locked or waits.
export class SharedFiles {
  readonly #context: TeamContext;
  // By canonical path: its latest change.
  readonly #changed = new Map<string, Change>();
  // By session, then canonical path: when it last read or changed the file.
  readonly #seen = new Map<string, Map<string, number>>();
  // Writes under way, by session and action.
  readonly #pending = new Map<string, string[]>();
  // Each overlap is told once per pair of sessions and file.
  readonly #told = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => this.#take(event));
  }

  // The session that last changed this file, while it is remembered.
  lastChange(path: string): { sessionId: string; at: number } | undefined {
    return this.#changed.get(canonicalPath(path));
  }

  #take(event: SessionEvent): void {
    const { sessionId } = event;
    switch (event.type) {
      case "action.started": {
        const { kind, locations = [], actionId } = event.payload;
        if (kind !== "read" && !WRITES.has(kind)) return;
        const paths = this.#paths(sessionId, locations);
        if (kind !== "read") {
          this.#pending.set(`${sessionId}:${actionId}`, paths);
          return;
        }
        const at = Date.parse(event.timestamp);
        for (const path of paths) this.#see(sessionId, canonicalPath(path), at);
        return;
      }
      case "action.ended": {
        const key = `${sessionId}:${event.payload.actionId}`;
        const paths = this.#pending.get(key);
        this.#pending.delete(key);
        if (paths === undefined || event.payload.outcome !== "completed") return;
        const at = Date.parse(event.timestamp);
        for (const path of paths) this.#changedBy(sessionId, path, at);
        return;
      }
      case "session.ended":
        this.#forget(sessionId);
        return;
      default:
        return;
    }
  }

  #paths(sessionId: string, locations: readonly string[]): string[] {
    const session = this.#context.store.getSession(sessionId);
    if (session === undefined) return [];
    return locations.flatMap((location) => hostPathOf(session, location) ?? []);
  }

  #see(sessionId: string, file: string, at: number): void {
    const seen = this.#seen.get(sessionId) ?? new Map<string, number>();
    seen.set(file, at);
    this.#seen.set(sessionId, seen);
  }

  #changedBy(sessionId: string, path: string, at: number): void {
    const file = canonicalPath(path);
    const before = this.#changed.get(file);
    const started = this.#context.store.getSession(sessionId)?.createdAt;
    const looked = this.#seen.get(sessionId)?.get(file) ?? (started ? Date.parse(started) : at);
    this.#changed.delete(file);
    this.#changed.set(file, { sessionId, at });
    const oldest = this.#changed.keys().next().value;
    if (this.#changed.size > CHANGES_KEPT && oldest !== undefined) this.#changed.delete(oldest);
    this.#see(sessionId, file, at);
    if (before === undefined || before.sessionId === sessionId || before.at <= looked) return;
    const pair = `${sessionId}|${before.sessionId}|${file}`;
    if (this.#told.has(pair)) return;
    this.#told.add(pair);
    this.#overlap(before, sessionId, path, at);
  }

  #overlap(before: Change, sessionId: string, path: string, at: number): void {
    const other = this.#nameOf(before.sessionId);
    const self = this.#nameOf(sessionId);
    const file = basename(path);
    this.#tell(
      sessionId,
      `${other} changed ${path} at ${clock(before.at)}, after you last read it. Read it again and keep their changes.`,
      `${other} also changed ${file}`,
    );
    // An agent between turns is not woken for this; the other trace shows it.
    if (this.#turnOpen(before.sessionId)) {
      this.#tell(
        before.sessionId,
        `${self} changed ${path} at ${clock(at)}, after your change. Check that your changes are still in it.`,
        `${self} changed ${file} after you`,
      );
    }
  }

  #nameOf(sessionId: string): string {
    const { store } = this.#context;
    const session = store.getSession(sessionId);
    return (session && store.getAgent(session.agentId)?.name) ?? "Another agent";
  }

  #turnOpen(sessionId: string): boolean {
    const { store } = this.#context;
    if (store.getSession(sessionId)?.status !== "running") return false;
    return store.latestTurn(sessionId)?.ended !== true;
  }

  #tell(sessionId: string, text: string, summary: string): void {
    if (this.#context.store.getSession(sessionId)?.status !== "running") return;
    this.#context.registry
      .tell(sessionId, { text, origin: { kind: "notice", summary } })
      .catch((error: unknown) =>
        console.error(`Could not tell ${sessionId} of a shared file.`, error),
      );
  }

  #forget(sessionId: string): void {
    this.#seen.delete(sessionId);
    for (const key of this.#pending.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.#pending.delete(key);
    }
    for (const pair of this.#told) {
      if (pair.split("|").includes(sessionId)) this.#told.delete(pair);
    }
  }
}
