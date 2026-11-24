import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  Change,
  DestinationRecord,
  DestinationSettings,
  TelegramLink,
} from "@office-town/contract";

// Messages are kept a month, at most 2,000, so a key queued again is still known (D-130).
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const MOST_KEPT = 2_000;

const DESTINATION_SELECT = `
  SELECT ref, id, name, settings, problem, link,
         created_at AS createdAt, updated_at AS updatedAt
  FROM destinations`;

const OUTBOX_SELECT = `
  SELECT o.ref, d.id AS destinationId, o.key, o.automation_id AS automationId, o.run_id AS runId,
         o.task_id AS taskId, o.message, o.state, o.attempts, o.next_at AS nextAt,
         o.created_at AS createdAt
  FROM outbox o JOIN destinations d ON d.ref = o.destination_ref`;

const queries = {
  insert: `
    INSERT INTO destinations (id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  update: "UPDATE destinations SET name = ?, settings = ?, updated_at = ? WHERE id = ?",
  setProblem: "UPDATE destinations SET problem = ? WHERE id = ?",
  setLink: "UPDATE destinations SET link = ?, updated_at = ? WHERE id = ?",
  remove: "DELETE FROM destinations WHERE id = ?",
  // A person keeps a handful.
  all: `${DESTINATION_SELECT} ORDER BY created_at`,
  byId: `${DESTINATION_SELECT} WHERE id = ?`,
  queue: `
    INSERT OR IGNORE INTO outbox
      (destination_ref, key, automation_id, run_id, task_id, message, state, next_at, created_at)
    VALUES ((SELECT ref FROM destinations WHERE id = ?), ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
  due: `${OUTBOX_SELECT} WHERE o.state = 'waiting' AND o.next_at <= ? ORDER BY o.next_at, o.ref`,
  earliest: "SELECT min(next_at) AS at FROM outbox WHERE state = 'waiting'",
  sent: "UPDATE outbox SET state = 'sent', attempts = attempts + 1 WHERE ref = ?",
  retry: "UPDATE outbox SET attempts = attempts + 1, next_at = ? WHERE ref = ?",
  failed: "UPDATE outbox SET state = 'failed', attempts = attempts + 1 WHERE ref = ?",
  staleBefore: `${OUTBOX_SELECT} WHERE o.state = 'waiting' AND o.created_at < ?`,
  pruneOld: "DELETE FROM outbox WHERE created_at < ?",
  pruneMost: `
    DELETE FROM outbox WHERE ref <= (SELECT coalesce(max(ref), 0) FROM outbox) - ?`,
};

interface DestinationRow {
  ref: number;
  id: string;
  name: string;
  settings: string;
  problem: string | null;
  link: string | null;
  createdAt: number;
  updatedAt: number;
}

// What a message is for: an automation's run, a person's task, or neither (an alert).
export interface SendOwner {
  automationId?: string;
  runId?: string;
  taskId?: string;
}

export interface OutboxRow {
  ref: number;
  destinationId: string;
  key: string;
  automationId: string | null;
  runId: string | null;
  taskId: string | null;
  // As the outbox wrote it, read back by the outbox only.
  message: string;
  state: "waiting" | "sent" | "failed";
  attempts: number;
  nextAt: number;
  createdAt: number;
}

const iso = (at: number) => new Date(at).toISOString();

const toDestination = (row: DestinationRow): DestinationRecord => ({
  id: row.id,
  name: row.name,
  settings: JSON.parse(row.settings) as DestinationSettings,
  ...(row.problem === null ? {} : { problem: row.problem }),
  ...(row.link === null ? {} : { link: JSON.parse(row.link) as TelegramLink }),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

// Where results go out, and every message for them, written before it is sent (D-130). Keys are
// in the credential store, never here.
export class DestinationsStore {
  readonly #statements: Record<keyof typeof queries, StatementSync>;
  readonly #publish: (change: Change) => void;

  constructor(db: DatabaseSync, publish: (change: Change) => void) {
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
    this.#publish = publish;
  }

  list(): DestinationRecord[] {
    return this.#statements.all.all().map((row) => toDestination(row as unknown as DestinationRow));
  }

  get(id: string): DestinationRecord | undefined {
    const row = this.#statements.byId.get(id) as DestinationRow | undefined;
    return row === undefined ? undefined : toDestination(row);
  }

  create(name: string, settings: DestinationSettings): DestinationRecord {
    const id = randomUUID();
    const now = Date.now();
    this.#statements.insert.run(id, name, JSON.stringify(settings), now, now);
    return this.#published(id);
  }

  update(id: string, name: string, settings: DestinationSettings): DestinationRecord {
    this.#statements.update.run(name, JSON.stringify(settings), Date.now(), id);
    return this.#published(id);
  }

  remove(id: string): void {
    this.#statements.remove.run(id);
    this.#publish({ type: "destination.removed", destinationId: id });
  }

  // Published only when it changes, as every send sets it.
  setProblem(id: string, problem: string | undefined): void {
    if (this.get(id)?.problem === problem) return;
    this.#statements.setProblem.run(problem ?? null, id);
    this.#published(id);
  }

  setLink(id: string, link: TelegramLink | undefined): DestinationRecord {
    this.#statements.setLink.run(link === undefined ? null : JSON.stringify(link), Date.now(), id);
    return this.#published(id);
  }

  // False when that key was queued before: each message goes out once.
  queue(destinationId: string, key: string, owner: SendOwner, message: string): boolean {
    const now = Date.now();
    const { changes } = this.#statements.queue.run(
      destinationId,
      key,
      owner.automationId ?? null,
      owner.runId ?? null,
      owner.taskId ?? null,
      message,
      now,
      now,
    );
    return changes > 0;
  }

  due(now: number): OutboxRow[] {
    return this.#statements.due.all(now) as unknown as OutboxRow[];
  }

  earliestDue(): number | undefined {
    const row = this.#statements.earliest.get() as { at: number | null } | undefined;
    return row?.at ?? undefined;
  }

  markSent(ref: number): void {
    this.#statements.sent.run(ref);
  }

  retryAt(ref: number, at: number): void {
    this.#statements.retry.run(at, ref);
  }

  markFailed(ref: number): void {
    this.#statements.failed.run(ref);
  }

  waitingSince(before: number): OutboxRow[] {
    return this.#statements.staleBefore.all(before) as unknown as OutboxRow[];
  }

  prune(): void {
    this.#statements.pruneOld.run(Date.now() - KEPT_MS);
    this.#statements.pruneMost.run(MOST_KEPT);
  }

  #published(id: string): DestinationRecord {
    const destination = this.get(id);
    if (destination === undefined) throw new Error(`No destination "${id}".`);
    this.#publish({ type: "destination", destination });
    return destination;
  }
}
