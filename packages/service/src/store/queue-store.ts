import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Change, QueuedStart, QueueEntry } from "@office-town/contract";

const ENTRY_SELECT = `
  SELECT q.id, q.kind, t.id AS taskId, r.id AS runId, q.state, q.reason,
         q.enqueued_at AS enqueuedAt, q.wait_until AS waitUntil
  FROM queue_entries q
  LEFT JOIN tasks t ON t.ref = q.task_ref
  LEFT JOIN automation_runs r ON r.ref = q.run_ref`;

const queries = {
  insertResume: `
    INSERT OR IGNORE INTO queue_entries
      (id, kind, task_ref, launch, state, enqueued_at, wait_until)
    VALUES (?, 'resume', (SELECT ref FROM tasks WHERE id = ?), ?, 'waiting', ?, ?)`,
  insertRun: `
    INSERT OR IGNORE INTO queue_entries
      (id, kind, run_ref, launch, state, enqueued_at, wait_until)
    VALUES (?, 'run', (SELECT ref FROM automation_runs WHERE id = ?), ?, 'waiting', ?, ?)`,
  byId: `${ENTRY_SELECT} WHERE q.id = ?`,
  ofTask: `${ENTRY_SELECT} WHERE q.kind = 'resume'
    AND q.task_ref = (SELECT ref FROM tasks WHERE id = ?) AND q.launch = ?`,
  ofRun: `${ENTRY_SELECT} WHERE q.run_ref = (SELECT ref FROM automation_runs WHERE id = ?)
    AND q.launch = ?`,
  waiting: `${ENTRY_SELECT} WHERE q.state = 'waiting' ORDER BY q.enqueued_at, q.ref`,
  update: "UPDATE queue_entries SET state = ?, reason = ? WHERE id = ?",
  setTask: "UPDATE queue_entries SET task_ref = (SELECT ref FROM tasks WHERE id = ?) WHERE id = ?",
  dropOtherLaunches: "DELETE FROM queue_entries WHERE launch != ?",
};

interface EntryRow {
  id: string;
  kind: QueuedStart["kind"];
  taskId: string | null;
  runId: string | null;
  state: QueueEntry["state"];
  reason: string | null;
  enqueuedAt: number;
  waitUntil: number;
}

const toEntry = (row: EntryRow): QueueEntry => ({
  id: row.id,
  what:
    row.kind === "run"
      ? { kind: "run", runId: row.runId ?? "" }
      : { kind: "resume", taskId: row.taskId ?? "" },
  ...(row.taskId === null ? {} : { taskId: row.taskId }),
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
    const insert = what.kind === "run" ? this.#statements.insertRun : this.#statements.insertResume;
    insert.run(
      id,
      what.kind === "run" ? what.runId : what.taskId,
      launch,
      Date.now(),
      waitUntil.getTime(),
    );
    const entry = this.ofTask(what, launch);
    if (entry === undefined)
      throw new Error(`The queue could not keep a start: ${JSON.stringify(what)}.`);
    if (entry.id === id) this.#publish({ type: "queue", entry });
    return entry;
  }

  ofTask(what: QueuedStart, launch: string): QueueEntry | undefined {
    const row = (
      what.kind === "run"
        ? this.#statements.ofRun.get(what.runId, launch)
        : this.#statements.ofTask.get(what.taskId, launch)
    ) as EntryRow | undefined;
    return row === undefined ? undefined : toEntry(row);
  }

  // A run's task, once it starts.
  setTask(id: string, taskId: string): void {
    this.#statements.setTask.run(taskId, id);
  }

  // Oldest first.
  waiting(): QueueEntry[] {
    return this.#statements.waiting.all().map((row) => toEntry(row as unknown as EntryRow));
  }

  // Published only when something changed. An entry deleted with its task is left alone.
  update(id: string, state: QueueEntry["state"], reason: string | undefined): void {
    const row = this.#statements.byId.get(id) as EntryRow | undefined;
    if (row === undefined) return;
    const before = toEntry(row);
    if (before.state === state && before.reason === reason) return;
    this.#statements.update.run(state, reason ?? null, id);
    const { reason: _, ...rest } = before;
    const entry: QueueEntry = { ...rest, state, ...(reason === undefined ? {} : { reason }) };
    this.#publish({ type: "queue", entry });
  }

  // An earlier launch's starts are not carried on: after a close, the user's own tasks ask first.
  dropOtherLaunches(launch: string): void {
    this.#statements.dropOtherLaunches.run(launch);
  }
}
