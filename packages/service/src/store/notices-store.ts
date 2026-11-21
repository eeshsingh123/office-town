import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Change, Notice, NoticeKind } from "@office-town/contract";

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_COUNT = 500;

const queries = {
  insert: `
    INSERT INTO notices (id, kind, task_ref, title, body, created_at)
    VALUES (?, ?, (SELECT ref FROM tasks WHERE id = ?), ?, ?, ?)`,
  latestOfKind: `
    SELECT n.id, n.kind, t.id AS taskId, n.title, n.body, n.created_at AS createdAt
    FROM notices n LEFT JOIN tasks t ON t.ref = n.task_ref
    WHERE n.kind = ? ORDER BY n.created_at DESC LIMIT 1`,
  deleteOlder: "DELETE FROM notices WHERE created_at < ?",
  // One is written at a time, so dropping the oldest keeps the count.
  deleteOldest: `
    DELETE FROM notices WHERE ref = (SELECT ref FROM notices ORDER BY created_at LIMIT 1)
      AND (SELECT count(*) FROM notices) > ?`,
};

interface NoticeRow {
  id: string;
  kind: NoticeKind;
  taskId: string | null;
  title: string;
  body: string;
  createdAt: number;
}

export type NewNotice = Omit<Notice, "id" | "createdAt">;

const toNotice = (row: NoticeRow): Notice => ({
  id: row.id,
  kind: row.kind,
  ...(row.taskId === null ? {} : { taskId: row.taskId }),
  title: row.title,
  body: row.body,
  createdAt: new Date(row.createdAt).toISOString(),
});

// The notices the core made (D-124), each published once as it is written.
export class NoticesStore {
  readonly #statements: Record<keyof typeof queries, StatementSync>;
  readonly #publish: (change: Change) => void;

  constructor(db: DatabaseSync, publish: (change: Change) => void) {
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
    this.#publish = publish;
  }

  create(notice: NewNotice): Notice {
    const now = Date.now();
    const record: Notice = { ...notice, id: randomUUID(), createdAt: new Date(now).toISOString() };
    this.#statements.insert.run(
      record.id,
      record.kind,
      record.taskId ?? null,
      record.title,
      record.body,
      now,
    );
    this.#statements.deleteOlder.run(now - KEEP_MS);
    this.#statements.deleteOldest.run(KEEP_COUNT);
    this.#publish({ type: "notice.created", notice: record });
    return record;
  }

  latestOf(kind: NoticeKind): Notice | undefined {
    const row = this.#statements.latestOfKind.get(kind) as NoticeRow | undefined;
    return row === undefined ? undefined : toNotice(row);
  }
}
