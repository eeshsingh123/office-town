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
  PROGRESS_PAGE,
  type ProgressUpdate,
  type ProgressUpdates,
} from "@office-town/contract";
import { transaction } from "./database.ts";

const DAY = 24 * 60 * 60 * 1000;
const MOST_KEPT = 2000;
const UPDATES_KEPT_DAYS = 30;
const TOLD_KEPT_DAYS = 90;

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
  insertUpdate: `
    INSERT INTO progress_updates (id, post_ref, mark_ref, data, search, created_at)
    VALUES (?, (SELECT ref FROM feed_posts WHERE id = ?), ?, ?, ?, ?)`,
  // A card's newest update and how many it has, read from its own rows.
  newestUpdate: `
    SELECT u.data, (SELECT count(*) FROM progress_updates WHERE post_ref = u.post_ref) AS count
    FROM progress_updates u WHERE u.post_ref = (SELECT ref FROM feed_posts WHERE id = ?)
    ORDER BY u.ref DESC LIMIT 1`,
  // Newest first; `before` is an update id, so a page never skips or repeats one.
  updatesPage: `
    SELECT data FROM progress_updates
    WHERE post_ref = (SELECT ref FROM feed_posts WHERE id = ?)
      AND (? IS NULL OR ref < (SELECT ref FROM progress_updates WHERE id = ?))
    ORDER BY ref DESC LIMIT ?`,
  // The gap and the last mark used are the task's, across every card it has had.
  latestUpdate: `
    SELECT max(u.created_at) AS at, max(u.mark_ref) AS mark FROM progress_updates u
    JOIN feed_posts p ON p.ref = u.post_ref
    WHERE p.task_ref = (SELECT ref FROM tasks WHERE id = ?)`,
  insertImage: `
    INSERT INTO progress_images (id, update_ref, type, bytes)
    VALUES (?, (SELECT ref FROM progress_updates WHERE id = ?), ?, ?)`,
  image: "SELECT type, bytes FROM progress_images WHERE id = ?",
  tellOnce: "INSERT INTO feed_told (key, at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING",
  pruneTold: "DELETE FROM feed_told WHERE at < ?",
  addMark: `
    INSERT INTO progress_marks (task_ref, key, after, at)
    VALUES ((SELECT ref FROM tasks WHERE id = ?), ?, ?, ?)
    ON CONFLICT (task_ref, key) DO NOTHING`,
  markOf: `
    SELECT ref, after FROM progress_marks WHERE task_ref = (SELECT ref FROM tasks WHERE id = ?)
    ORDER BY ref DESC LIMIT 1`,
  // Past the most kept, the oldest that are not an open ask, a task at work or a card with
  // progress updates go first: those stay their full time.
  overflow: `
    SELECT id FROM feed_posts WHERE expires_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM progress_updates u WHERE u.post_ref = feed_posts.ref)
    ORDER BY created_at LIMIT max(0, (SELECT count(*) FROM feed_posts) - ?)`,
};

interface DataRow {
  data: string;
}

const parse = (row: DataRow | undefined): FeedPost | undefined =>
  row === undefined ? undefined : (JSON.parse(row.data) as FeedPost);

const searchText = (post: { title: string; body?: string | undefined }) =>
  `${post.title}\n${post.body ?? ""}`.toLowerCase();

function expiresAt(post: FeedPost, at: number): number | null {
  if (post.state === "open" && post.kind !== "suggested") return null;
  // A card with progress updates had activity: it stays 30 days from its last change (D-141).
  return at + (post.updates === undefined ? KEPT_DAYS[post.kind] : UPDATES_KEPT_DAYS) * DAY;
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

  // A post whose key is taken is not written: the one there stands. A new post has no updates.
  create(draft: PostDraft, { key = null, foldKey }: Placement = {}, at = Date.now()): FeedPost {
    const time = new Date(at).toISOString();
    const { update: _, updates: __, ...fresh } = draft;
    const post: FeedPost = { ...fresh, id: randomUUID(), createdAt: time, updatedAt: time };
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
      ...this.#withUpdates(before.id, draft),
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

  // A card's updates and their pictures go with it, and with nothing else.
  remove(id: string): void {
    const { changes } = this.#statements.remove.run(id);
    if (changes > 0) this.#tell({ type: "feed.removed", postId: id });
  }

  // A draft with the card's newest update and count as its own rows have them.
  #withUpdates(postId: string, draft: PostDraft): PostDraft {
    const { update: _, updates: __, ...rest } = draft;
    const row = this.#statements.newestUpdate.get(postId) as
      | { data: string; count: number }
      | undefined;
    if (row === undefined) return rest;
    return { ...rest, update: JSON.parse(row.data) as ProgressUpdate, updates: row.count };
  }

  updatesOf(postId: string, before?: string): ProgressUpdates {
    const rows = this.#statements.updatesPage.all(
      postId,
      before ?? null,
      before ?? null,
      PROGRESS_PAGE + 1,
    ) as unknown as DataRow[];
    const updates = rows
      .slice(0, PROGRESS_PAGE)
      .map((row) => JSON.parse(row.data) as ProgressUpdate);
    return { updates, more: rows.length > PROGRESS_PAGE };
  }

  // When the task's last update was taken, and the mark it used.
  latestUpdate(taskId: string): { at: number; mark: number | undefined } | undefined {
    const row = this.#statements.latestUpdate.get(taskId) as {
      at: number | null;
      mark: number | null;
    };
    return row.at === null ? undefined : { at: row.at, mark: row.mark ?? undefined };
  }

  // On the card it was posted on, with its picture; the card then rises to the top.
  addUpdate(
    card: FeedPost,
    update: ProgressUpdate,
    markRef: number,
    image?: { type: string; bytes: Uint8Array },
  ): FeedPost {
    return this.batch(() => {
      this.#statements.insertUpdate.run(
        update.id,
        card.id,
        markRef,
        JSON.stringify(update),
        searchText(update),
        Date.parse(update.at),
      );
      if (image !== undefined && update.image !== undefined) {
        this.#statements.insertImage.run(update.image.id, update.id, image.type, image.bytes);
      }
      return this.update(card, draftOf(card), { rise: true });
    });
  }

  image(id: string): { type: string; bytes: Uint8Array } | undefined {
    return this.#statements.image.get(id) as { type: string; bytes: Uint8Array } | undefined;
  }

  // True the first time a thing is told: a post made once ever, across restarts.
  tellOnce(key: string): boolean {
    return this.#statements.tellOnce.run(key, Date.now()).changes > 0;
  }

  // Each thing that happens in a task is kept once under its key, however often it is heard.
  addMark(taskId: string, key: string, after: string, at = Date.now()): void {
    this.#statements.addMark.run(taskId, key, after, at);
  }

  // The newest thing that happened in a task, which earns its next update (D-141).
  markOf(taskId: string): { ref: number; after: string } | undefined {
    return this.#statements.markOf.get(taskId) as { ref: number; after: string } | undefined;
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
      // A card is found by its own updates' words too.
      where.push(`(instr(search, ?) > 0 OR EXISTS (
        SELECT 1 FROM progress_updates u
        WHERE u.post_ref = feed_posts.ref AND instr(u.search, ?) > 0))`);
      values.push(search.toLowerCase(), search.toLowerCase());
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
      // Past the longest a post it told is kept, telling it again cannot double one.
      this.#statements.pruneTold.run(now - TOLD_KEPT_DAYS * DAY);
    });
  }

  #tell(change: Change): void {
    if (this.#held === undefined) this.#publish(change);
    else this.#held.push(change);
  }
}
