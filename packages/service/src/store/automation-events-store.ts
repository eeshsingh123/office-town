import type { DatabaseSync, StatementSync } from "node:sqlite";
import { transaction } from "./database.ts";

// A key no source has listed for this long is forgotten, so the table stays small.
export const EVENTS_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

const queries = {
  insert: `
    INSERT OR IGNORE INTO automation_events
      (automation_ref, key, at, seen_at, text, depth, pending)
    VALUES ((SELECT ref FROM automations WHERE id = ?), ?, ?, ?, ?, ?, ?)`,
  // Still listed by its source, so it is not forgotten and seen again as new.
  touch: `
    UPDATE automation_events SET seen_at = ?
    WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?) AND key = ? AND pending = 0`,
  pending: `
    SELECT count(*) AS count, min(seen_at) AS first, max(depth) AS depth FROM automation_events
    WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?) AND pending = 1`,
  attach: `
    UPDATE automation_events SET pending = 0, run_ref = (SELECT ref FROM automation_runs WHERE id = ?)
    WHERE ref IN (SELECT ref FROM automation_events
      WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?) AND pending = 1
      ORDER BY ref LIMIT ?)`,
  ofRun: `
    SELECT key, at, text FROM automation_events
    WHERE run_ref = (SELECT ref FROM automation_runs WHERE id = ?) ORDER BY ref`,
  clearText: `
    UPDATE automation_events SET text = NULL
    WHERE run_ref = (SELECT ref FROM automation_runs WHERE id = ?)`,
  prune: "DELETE FROM automation_events WHERE seen_at < ? AND pending = 0",
  state: "SELECT source_state AS state FROM automations WHERE id = ?",
  setState: "UPDATE automations SET source_state = ? WHERE id = ?",
};

export interface SeenEvent {
  key: string;
  // When it happened, as far as its source knows.
  at: number;
  text: string;
  // How many automation runs in a row led to it: a file another run wrote counts one more.
  depth?: number;
}

export interface PendingEvents {
  count: number;
  first: number;
  depth: number;
}

export interface EventText {
  key: string;
  at: number;
  text: string;
}

// What each automation's source has seen (D-128), so nothing starts a second run, and what waits
// for the next run. A source's own place (an ETag, the last look) is kept beside the automation.
export class AutomationEventsStore {
  readonly #db: DatabaseSync;
  readonly #statements: Record<keyof typeof queries, StatementSync>;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
  }

  // How many were new. A known start point is only remembered, never run.
  take(automationId: string, events: readonly SeenEvent[], known = false): number {
    const now = Date.now();
    let added = 0;
    transaction(this.#db, () => {
      for (const event of events) {
        const { changes } = this.#statements.insert.run(
          automationId,
          event.key,
          event.at,
          now,
          known ? null : event.text,
          event.depth ?? 0,
          known ? 0 : 1,
        );
        if (Number(changes) > 0) added += 1;
        else this.#statements.touch.run(now, automationId, event.key);
      }
    });
    return added;
  }

  pending(automationId: string): PendingEvents | undefined {
    const row = this.#statements.pending.get(automationId) as
      | { count: number; first: number | null; depth: number | null }
      | undefined;
    if (row === undefined || row.count === 0 || row.first === null) return undefined;
    return { count: row.count, first: row.first, depth: row.depth ?? 0 };
  }

  // The oldest waiting ones join the run; how many did.
  attach(automationId: string, runId: string, most: number): number {
    if (most <= 0) return 0;
    return Number(this.#statements.attach.run(runId, automationId, most).changes);
  }

  ofRun(runId: string): EventText[] {
    return (
      this.#statements.ofRun.all(runId) as { key: string; at: number; text: string | null }[]
    ).flatMap((row) => (row.text === null ? [] : [{ key: row.key, at: row.at, text: row.text }]));
  }

  // Once its run has the text in its prompt, only the key is kept.
  clearText(runId: string): void {
    this.#statements.clearText.run(runId);
  }

  prune(now = Date.now()): void {
    this.#statements.prune.run(now - EVENTS_KEPT_MS);
  }

  state<T>(automationId: string): T | undefined {
    const row = this.#statements.state.get(automationId) as { state: string | null } | undefined;
    return row?.state == null ? undefined : (JSON.parse(row.state) as T);
  }

  setState(automationId: string, state: unknown): void {
    this.#statements.setState.run(state === undefined ? null : JSON.stringify(state), automationId);
  }
}
