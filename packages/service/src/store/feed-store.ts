import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  type Change,
  FEED_PAGE,
  FEED_SHOWN,
  type FeedKind,
  type FeedPage,
  type FeedPost,
  type FeedQuery,
} from "@office-town/contract";
import { transaction } from "./database.ts";

const DAY = 24 * 60 * 60 * 1000;
const MOST_KEPT = 2000;

// Kept from its last change (D-137); an ask waiting or a task at work is kept until it closes. A
// suggestion is kept 30 days, open or not, so the same one is never made twice in a month (D-139).
const KEPT_DAYS: Record<FeedKind, number> = {
  "needs-you": 7,
  living: 7,
  result: 30,
  milestone: 30,
  stopped: 7,
  automation: 7,
  "heads-up": 7,
  suggested: 30,
};

export type PostDraft = Omit<FeedPost, "id" | "createdAt" | "updatedAt">;

// A post as a draft, to write it again with a change.
export const draftOf = ({ id: _, createdAt: __, updatedAt: ___, ...draft }: FeedPost): PostDraft =>
  draft;

const queries = {
  insert: `
    INSERT INTO feed_posts
      (id, key, kind, task_ref, department_id, fold_key, state, data, search, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, (SELECT ref FROM tasks WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO NOTHING`,
  update: `
    UPDATE feed_posts SET key = ?, kind = ?, department_id = ?, state = ?, data = ?, search = ?,
      created_at = ?, updated_at = ?, expires_at = ?
    WHERE id = ?`,
  byId: "SELECT data FROM feed_posts WHERE id = ?",
  byKey: "SELECT data FROM feed_posts WHERE key = ?",
  keyed: "SELECT data FROM feed_posts WHERE key LIKE ? AND state = 'open'",
  // The newest of a fold, while it is still close enough to join.
  latestFold: `
    SELECT data FROM feed_posts WHERE fold_key = ? AND created_at >= ?
    ORDER BY created_at DESC LIMIT 1`,
  position: "SELECT created_at AS at, ref, key FROM feed_posts WHERE id = ?",
  remove: "DELETE FROM feed_posts WHERE id = ?",
  countOf: "SELECT count(*) AS count FROM feed_posts WHERE kind = ? AND created_at >= ?",
  countForTask: `
    SELECT count(*) AS count FROM feed_posts
    WHERE kind = ? AND task_ref = (SELECT ref FROM tasks WHERE id = ?) AND created_at >= ?`,
  expired: "SELECT id FROM feed_posts WHERE expires_at < ?",
  // When the user asked for the same thing before, in tasks of their own.
  sameRequests: `
    SELECT created_at AS at FROM tasks
    WHERE prompt = ? AND created_at >= ? AND parent_ref IS NULL
      AND (origin IS NULL OR origin = '{"kind":"you"}')
    ORDER BY created_at`,
  // Past the most kept, the oldest that are not an open ask or a task at work go first.
  overflow: `
    SELECT id FROM feed_posts WHERE expires_at IS NOT NULL
    ORDER BY created_at LIMIT max(0, (SELECT count(*) FROM feed_posts) - ?)`,
};

interface DataRow {
  data: string;
}

const parse = (row: DataRow | undefined): FeedPost | undefined =>
  row === undefined ? undefined : (JSON.parse(row.data) as FeedPost);

const searchText = (post: FeedPost) => `${post.title}\n${post.body ?? ""}`.toLowerCase();

function expiresAt(post: FeedPost, at: number): number | null {
  if (post.state === "open" && post.kind !== "suggested") return null;
  return at + KEPT_DAYS[post.kind] * DAY;
}

export interface Placement {
  // While set, the post stands for one thing that can change, such as a task at work or an ask.
  key?: string | null;
  // Posts with the same fold key, close together, become one.
  foldKey?: string;
}

// Feed's posts (D-137). Writes inside `batch` are published once committed.
export class FeedStore {
  readonly #db: DatabaseSync;
  readonly #statements: Record<keyof typeof queries, StatementSync>;
  readonly #publish: (change: Change) => void;
  #held: Change[] | undefined;

  constructor(db: DatabaseSync, publish: (change: Change) => void) {
    this.#db = db;
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
    this.#publish = publish;
  }

  batch<T>(work: () => T): T {
    if (this.#held !== undefined) return work();
    const held: Change[] = [];
    this.#held = held;
    let result: T;
    try {
      result = transaction(this.#db, work);
    } finally {
      this.#held = undefined;
    }
    for (const change of held) this.#publish(change);
    return result;
  }

  get(id: string): FeedPost | undefined {
    return parse(this.#statements.byId.get(id) as DataRow | undefined);
  }

  byKey(key: string): FeedPost | undefined {
    return parse(this.#statements.byKey.get(key) as DataRow | undefined);
  }

  // Open posts whose key starts with `prefix`, such as every task at work.
  openKeyed(prefix: string): FeedPost[] {
    return (this.#statements.keyed.all(`${prefix}%`) as unknown as DataRow[]).flatMap(
      (row) => parse(row) ?? [],
    );
  }

  latestFold(foldKey: string, since: number): FeedPost | undefined {
    return parse(this.#statements.latestFold.get(foldKey, since) as DataRow | undefined);
  }

  // A post whose key is taken is not written: the one there stands.
  create(draft: PostDraft, { key = null, foldKey }: Placement = {}, at = Date.now()): FeedPost {
    const time = new Date(at).toISOString();
    const post: FeedPost = { ...draft, id: randomUUID(), createdAt: time, updatedAt: time };
    const { changes } = this.#statements.insert.run(
      post.id,
      key,
      post.kind,
      post.taskId ?? null,
      post.departmentId ?? null,
      foldKey ?? null,
      post.state,
      JSON.stringify(post),
      searchText(post),
      at,
      at,
      expiresAt(post, at),
    );
    if (changes === 0 && key !== null) return this.byKey(key) ?? post;
    this.#tell({ type: "feed.post", post });
    return post;
  }

  // `rise` makes it new again, so it moves to the top, as a task's result does.
  update(
    before: FeedPost,
    draft: PostDraft,
    { key, rise = false }: { key?: string | null; rise?: boolean } = {},
  ): FeedPost {
    const at = Date.now();
    const time = new Date(at).toISOString();
    const post: FeedPost = {
      ...draft,
      id: before.id,
      createdAt: rise ? time : before.createdAt,
      updatedAt: time,
    };
    const position = this.#statements.position.get(before.id) as
      | { at: number; key: string | null }
      | undefined;
    if (position === undefined) return before;
    const keyFor = key === undefined ? position.key : key;
    const same =
      JSON.stringify({ ...post, updatedAt: "" }) === JSON.stringify({ ...before, updatedAt: "" });
    if (same && keyFor === position.key) return before;
    this.#statements.update.run(
      keyFor,
      post.kind,
      post.departmentId ?? null,
      post.state,
      JSON.stringify(post),
      searchText(post),
      rise ? at : position.at,
      at,
      expiresAt(post, at),
      post.id,
    );
    this.#tell({ type: "feed.post", post });
    return post;
  }

  remove(id: string): void {
    const { changes } = this.#statements.remove.run(id);
    if (changes > 0) this.#tell({ type: "feed.removed", postId: id });
  }

  countSince(kind: FeedKind, since: number): number {
    return (this.#statements.countOf.get(kind, since) as { count: number }).count;
  }

  countForTask(kind: FeedKind, taskId: string, since: number): number {
    return (this.#statements.countForTask.get(kind, taskId, since) as { count: number }).count;
  }

  sameRequests(prompt: string, since: number): number[] {
    return (this.#statements.sameRequests.all(prompt, since) as { at: number }[]).map(
      (row) => row.at,
    );
  }

  page({ before, show, departmentId, search }: FeedQuery): FeedPage {
    // A suggestion the user turned down is gone from the page.
    const where: string[] = ["NOT (kind = 'suggested' AND state <> 'open')"];
    const values: (string | number)[] = [];
    if (before !== undefined) {
      const position = this.#statements.position.get(before) as
        | { at: number; ref: number }
        | undefined;
      if (position !== undefined) {
        where.push("(created_at < ? OR (created_at = ? AND ref < ?))");
        values.push(position.at, position.at, position.ref);
      }
    }
    if (show !== "all") {
      const kinds = FEED_SHOWN[show];
      where.push(`kind IN (${kinds.map(() => "?").join(", ")})`);
      values.push(...kinds);
    }
    if (departmentId !== undefined) {
      where.push("department_id = ?");
      values.push(departmentId);
    }
    if (search !== undefined) {
      where.push("instr(search, ?) > 0");
      values.push(search.toLowerCase());
    }
    const rows = this.#db
      .prepare(`
        SELECT data FROM feed_posts WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, ref DESC LIMIT ?`)
      .all(...values, FEED_PAGE + 1) as unknown as DataRow[];
    const posts = rows.slice(0, FEED_PAGE).flatMap((row) => parse(row) ?? []);
    return { posts, more: rows.length > FEED_PAGE };
  }

  // Expired posts, then the oldest past the most kept.
  prune(now = Date.now()): void {
    this.batch(() => {
      const expired = this.#statements.expired.all(now) as { id: string }[];
      const overflow = this.#statements.overflow.all(MOST_KEPT) as { id: string }[];
      for (const { id } of [...expired, ...overflow]) this.remove(id);
    });
  }

  #tell(change: Change): void {
    if (this.#held === undefined) this.#publish(change);
    else this.#held.push(change);
  }
}
