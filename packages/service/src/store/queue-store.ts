import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Change, QueuedStart, QueueEntry } from "@office-town/contract";

const ENTRY_SELECT = `
  SELECT q.id, q.kind, t.id AS taskId, q.state, q.reason, q.enqueued_at AS enqueuedAt,
         q.wait_until AS waitUntil
  FROM queue_entries q JOIN tasks t ON t.ref = q.task_ref`;

const queries = {
  insert: `
    INSERT OR IGNORE INTO queue_entries
      (id, kind, task_ref, launch, state, enqueued_at, wait_until)
    VALUES (?, ?, (SELECT ref FROM tasks WHERE id = ?), ?, 'waiting', ?, ?)`,
  byId: `${ENTRY_SELECT} WHERE q.id = ?`,
  ofTask: `${ENTRY_SELECT} WHERE q.kind = ? AND q.task_ref = (SELECT ref FROM tasks WHERE id = ?)
    AND q.launch = ?`,
  waiting: `${ENTRY_SELECT} WHERE q.state = 'waiting' ORDER BY q.enqueued_at, q.ref`,
  update: "UPDATE queue_entries SET state = ?, reason = ? WHERE id = ?",
  dropOtherLaunches: "DELETE FROM queue_entries WHERE launch != ?",
};

interface EntryRow {
  id: string;
  kind: QueuedStart["kind"];
  taskId: string;
  state: QueueEntry["state"];
  reason: string | null;
  enqueuedAt: number;
  waitUntil: number;
}

const toEntry = (row: EntryRow): QueueEntry => ({
  id: row.id,
  what: { kind: row.kind, taskId: row.taskId },
  taskId: row.taskId,
  enqueuedAt: new Date(row.enqueuedAt).toISOString(),
  waitUntil: new Date(row.waitUntil).toISOString(),
  state: row.state,
  ...(row.reason === null ? {} : { reason: row.reason }),
});

// The admission queue's entries (D-121), keyed by what starts and the launch, so a start is
// written before it runs and never runs twice in one launch.
export class QueueStore {
  readonly #statements: Record<keyof typeof queries, StatementSync>;
  readonly #publish: (change: Change) => void;

  constructor(db: DatabaseSync, publish: (change: Change) => void) {
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
    this.#publish = publish;
  }

  // The entry this launch already has for it, if any; a new one waits.
  add(what: QueuedStart, launch: string, waitUntil: Date): QueueEntry {
    const id = randomUUID();
    this.#statements.insert.run(
      id,
      what.kind,
      what.taskId,
      launch,
      Date.now(),
      waitUntil.getTime(),
    );
    const entry = this.ofTask(what, launch);
    if (entry === undefined)
      throw new Error(`The queue could not keep a start for ${what.taskId}.`);
    if (entry.id === id) this.#publish({ type: "queue", entry });
    return entry;
  }

  ofTask(what: QueuedStart, launch: string): QueueEntry | undefined {
    const row = this.#statements.ofTask.get(what.kind, what.taskId, launch) as EntryRow | undefined;
    return row === undefined ? undefined : toEntry(row);
  }

  // Oldest first.
  waiting(): QueueEntry[] {
    return this.#statements.waiting.all().map((row) => toEntry(row as unknown as EntryRow));
  }

  // Published only when something changed.
  update(id: string, state: QueueEntry["state"], reason: string | undefined): QueueEntry {
    const row = this.#statements.byId.get(id) as EntryRow | undefined;
    if (row === undefined) throw new Error(`No queue entry ${id}.`);
    const before = toEntry(row);
    if (before.state === state && before.reason === reason) return before;
    this.#statements.update.run(state, reason ?? null, id);
    const { reason: _, ...rest } = before;
    const entry: QueueEntry = { ...rest, state, ...(reason === undefined ? {} : { reason }) };
    this.#publish({ type: "queue", entry });
    return entry;
  }

  // An earlier launch's starts are not carried on: after a close, the user's own tasks ask first.
  dropOtherLaunches(launch: string): void {
    this.#statements.dropOtherLaunches.run(launch);
  }
}
