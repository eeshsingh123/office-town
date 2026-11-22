import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  type AutomationFields,
  type AutomationPause,
  type AutomationRecord,
  type AutomationRun,
  type Change,
  RUN_TAB_STATUSES,
  RUNS_KEPT,
  type RunPage,
  type RunPageQuery,
  type RunStatus,
  type RunTab,
  runPageQuerySchema,
} from "@office-town/contract";
import { transaction } from "./database.ts";

const AUTOMATION_SELECT = `
  SELECT ref, id, name, enabled, fields, paused, next_run_at AS nextRunAt, failures,
         created_at AS createdAt, updated_at AS updatedAt
  FROM automations`;

const RUN_SELECT = `
  SELECT r.ref, r.id, a.id AS automationId, r.number, r.scheduled_for AS scheduledFor, r.by,
         r.status, r.reason, r.missed, r.depth, r.wait_until AS waitUntil, t.id AS taskId,
         r.created_at AS createdAt, r.ended_at AS endedAt
  FROM automation_runs r
  JOIN automations a ON a.ref = r.automation_ref
  LEFT JOIN tasks t ON t.ref = r.task_ref`;

const queries = {
  insert: `
    INSERT INTO automations (id, name, enabled, fields, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  update: "UPDATE automations SET name = ?, enabled = ?, fields = ?, updated_at = ? WHERE id = ?",
  setPaused: "UPDATE automations SET paused = ? WHERE id = ?",
  setNextRun: "UPDATE automations SET next_run_at = ? WHERE id = ?",
  setFailures: "UPDATE automations SET failures = ? WHERE id = ?",
  remove: "DELETE FROM automations WHERE id = ?",
  // The list page shows every one; a person keeps a handful to a few hundred.
  all: `${AUTOMATION_SELECT} ORDER BY created_at`,
  byId: `${AUTOMATION_SELECT} WHERE id = ?`,
  earliest: "SELECT min(next_run_at) AS at FROM automations WHERE next_run_at IS NOT NULL",
  due: `${AUTOMATION_SELECT} WHERE next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at`,
  insertRun: `
    INSERT OR IGNORE INTO automation_runs
      (id, automation_ref, number, scheduled_for, by, status, reason, missed, depth, wait_until,
       created_at, ended_at)
    VALUES (?, (SELECT ref FROM automations WHERE id = ?),
      (SELECT coalesce(max(number), 0) + 1 FROM automation_runs
       WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?)),
      ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  runById: `${RUN_SELECT} WHERE r.id = ?`,
  runOfTask: `${RUN_SELECT} WHERE r.task_ref = (SELECT ref FROM tasks WHERE id = ?)`,
  latestRun: `${RUN_SELECT} WHERE r.automation_ref = ? ORDER BY r.number DESC LIMIT 1`,
  waitingRuns: `${RUN_SELECT} WHERE r.status = 'waiting' ORDER BY r.created_at`,
  unendedRuns: `${RUN_SELECT} WHERE r.ended_at IS NULL ORDER BY r.created_at`,
  // Its newest runs that are not over, read through its own newest rows.
  openRuns: `
    SELECT id FROM (SELECT id, status FROM automation_runs
      WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?)
      ORDER BY number DESC LIMIT 20)
    WHERE status IN ('waiting', 'working', 'queued', 'needs')`,
  lastFinishedTask: `
    SELECT t.id AS taskId FROM automation_runs r JOIN tasks t ON t.ref = r.task_ref
    WHERE r.automation_ref = (SELECT ref FROM automations WHERE id = ?)
      AND r.status IN ('review', 'done')
    ORDER BY r.number DESC LIMIT 1`,
  page: `${RUN_SELECT} WHERE r.automation_ref = (SELECT ref FROM automations WHERE id = ?)
    AND r.number < ? AND (? = 0 OR r.status IN (SELECT value FROM json_each(?)))
    ORDER BY r.number DESC LIMIT ?`,
  counts: `
    SELECT status, count(*) AS count FROM automation_runs
    WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?) GROUP BY status`,
  updateRun: `
    UPDATE automation_runs SET status = ?, reason = ?, task_ref = (SELECT ref FROM tasks WHERE id = ?),
      wait_until = ?, ended_at = ?
    WHERE id = ?`,
  prune: `
    DELETE FROM automation_runs WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?)
      AND number <= (SELECT coalesce(max(number), 0) FROM automation_runs
        WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?)) - ?`,
  clearFiles: `
    DELETE FROM automation_files WHERE automation_ref = (SELECT ref FROM automations WHERE id = ?)`,
  addFile: `
    INSERT OR IGNORE INTO automation_files (automation_ref, attachment_ref)
    SELECT (SELECT ref FROM automations WHERE id = ?), ref FROM attachments WHERE id = ?`,
};

interface AutomationRow {
  ref: number;
  id: string;
  name: string;
  enabled: number;
  fields: string;
  paused: string | null;
  nextRunAt: number | null;
  failures: number;
  createdAt: number;
  updatedAt: number;
}

interface RunRow {
  ref: number;
  id: string;
  automationId: string;
  number: number;
  scheduledFor: number;
  by: AutomationRun["by"];
  status: RunStatus;
  reason: string | null;
  missed: number | null;
  depth: number;
  waitUntil: number | null;
  taskId: string | null;
  createdAt: number;
  endedAt: number | null;
}

type Stored = Pick<AutomationFields, "task" | "trigger" | "rules">;

const iso = (at: number) => new Date(at).toISOString();

const toRun = (row: RunRow): AutomationRun => ({
  id: row.id,
  automationId: row.automationId,
  number: row.number,
  scheduledFor: iso(row.scheduledFor),
  by: row.by,
  status: row.status,
  ...(row.reason === null ? {} : { reason: row.reason }),
  ...(row.missed === null ? {} : { missed: row.missed }),
  depth: row.depth,
  ...(row.waitUntil === null ? {} : { waitUntil: iso(row.waitUntil) }),
  ...(row.taskId === null ? {} : { taskId: row.taskId }),
  createdAt: iso(row.createdAt),
  ...(row.endedAt === null ? {} : { endedAt: iso(row.endedAt) }),
});

export interface NewRun {
  automationId: string;
  scheduledFor: Date;
  by: AutomationRun["by"];
  depth: number;
  status: Extract<RunStatus, "waiting" | "skipped">;
  reason?: string;
  missed?: number;
  waitUntil?: Date;
}

export type RunChange = Partial<
  Pick<AutomationRun, "status" | "reason" | "taskId" | "waitUntil" | "endedAt">
>;

// Automations and their runs (D-125), each change published whole after its write.
export class AutomationsStore {
  readonly #db: DatabaseSync;
  readonly #statements: Record<keyof typeof queries, StatementSync>;
  readonly #publish: (change: Change) => void;

  constructor(db: DatabaseSync, publish: (change: Change) => void) {
    this.#db = db;
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
    this.#publish = publish;
  }

  list(): AutomationRecord[] {
    return this.#statements.all
      .all()
      .map((row) => this.#toAutomation(row as unknown as AutomationRow));
  }

  get(id: string): AutomationRecord | undefined {
    const row = this.#statements.byId.get(id) as AutomationRow | undefined;
    return row === undefined ? undefined : this.#toAutomation(row);
  }

  create(fields: AutomationFields, files: readonly string[]): AutomationRecord {
    const id = randomUUID();
    const now = Date.now();
    transaction(this.#db, () => {
      this.#statements.insert.run(
        id,
        fields.name,
        fields.enabled ? 1 : 0,
        JSON.stringify(this.#stored(fields)),
        now,
        now,
      );
      this.#setFiles(id, files);
    });
    return this.#published(id);
  }

  update(id: string, fields: AutomationFields, files: readonly string[]): AutomationRecord {
    transaction(this.#db, () => {
      this.#statements.update.run(
        fields.name,
        fields.enabled ? 1 : 0,
        JSON.stringify(this.#stored(fields)),
        Date.now(),
        id,
      );
      this.#setFiles(id, files);
    });
    return this.#published(id);
  }

  setEnabled(id: string, enabled: boolean): AutomationRecord {
    const current = this.get(id);
    if (current === undefined) throw new Error(`No automation "${id}".`);
    const { task, trigger, rules, name } = current;
    this.#statements.update.run(
      name,
      enabled ? 1 : 0,
      JSON.stringify({ task, trigger, rules }),
      Date.now(),
      id,
    );
    return this.#published(id);
  }

  remove(id: string): void {
    this.#statements.remove.run(id);
    this.#publish({ type: "automation.removed", automationId: id });
  }

  setPaused(id: string, paused: AutomationPause | undefined): void {
    this.#statements.setPaused.run(paused === undefined ? null : JSON.stringify(paused), id);
    this.#published(id);
  }

  setNextRun(id: string, at: Date | undefined): void {
    const before = this.get(id)?.nextRunAt;
    const next = at?.toISOString();
    if (before === next) return;
    this.#statements.setNextRun.run(at?.getTime() ?? null, id);
    this.#published(id);
  }

  setFailures(id: string, failures: number): void {
    this.#statements.setFailures.run(failures, id);
    this.#published(id);
  }

  earliestNextRun(): number | undefined {
    const row = this.#statements.earliest.get() as { at: number | null } | undefined;
    return row?.at ?? undefined;
  }

  due(now: number): AutomationRecord[] {
    return this.#statements.due
      .all(now)
      .map((row) => this.#toAutomation(row as unknown as AutomationRow));
  }

  // Undefined when its key was written before: that run already fired.
  addRun(run: NewRun): AutomationRun | undefined {
    const id = randomUUID();
    const now = Date.now();
    const ended = run.status === "skipped" ? now : null;
    const { changes } = this.#statements.insertRun.run(
      id,
      run.automationId,
      run.automationId,
      run.scheduledFor.getTime(),
      run.by,
      run.status,
      run.reason ?? null,
      run.missed ?? null,
      run.depth,
      run.waitUntil?.getTime() ?? null,
      now,
      ended,
    );
    if (changes === 0) return undefined;
    this.#statements.prune.run(run.automationId, run.automationId, RUNS_KEPT);
    const created = this.getRun(id);
    if (created === undefined) throw new Error(`The run of ${run.automationId} was not kept.`);
    this.#publish({ type: "run", run: created });
    this.#published(run.automationId);
    return created;
  }

  getRun(id: string): AutomationRun | undefined {
    const row = this.#statements.runById.get(id) as RunRow | undefined;
    return row === undefined ? undefined : toRun(row);
  }

  runOfTask(taskId: string): AutomationRun | undefined {
    const row = this.#statements.runOfTask.get(taskId) as RunRow | undefined;
    return row === undefined ? undefined : toRun(row);
  }

  waitingRuns(): AutomationRun[] {
    return this.#statements.waitingRuns.all().map((row) => toRun(row as unknown as RunRow));
  }

  // Waiting, or with a task that has not ended.
  unendedRuns(): AutomationRun[] {
    return this.#statements.unendedRuns.all().map((row) => toRun(row as unknown as RunRow));
  }

  openRuns(automationId: string): AutomationRun[] {
    return (this.#statements.openRuns.all(automationId) as { id: string }[]).flatMap(
      ({ id }) => this.getRun(id) ?? [],
    );
  }

  lastFinishedTask(automationId: string): string | undefined {
    const row = this.#statements.lastFinishedTask.get(automationId) as
      | { taskId: string }
      | undefined;
    return row?.taskId;
  }

  // Published only when something changed.
  updateRun(id: string, change: RunChange): AutomationRun | undefined {
    const before = this.getRun(id);
    if (before === undefined) return undefined;
    const after: AutomationRun = { ...before, ...change };
    if (JSON.stringify(after) === JSON.stringify(before)) return before;
    this.#statements.updateRun.run(
      after.status,
      after.reason ?? null,
      after.taskId ?? null,
      after.waitUntil === undefined ? null : Date.parse(after.waitUntil),
      after.endedAt === undefined ? null : Date.parse(after.endedAt),
      id,
    );
    const run = this.getRun(id);
    if (run === undefined) return undefined;
    this.#publish({ type: "run", run });
    this.#published(run.automationId);
    return run;
  }

  runs(automationId: string, query: RunPageQuery): RunPage {
    const { tab, limit, before } = runPageQuerySchema.parse(query);
    const statuses = tab === "all" ? [] : RUN_TAB_STATUSES[tab];
    const rows = this.#statements.page.all(
      automationId,
      before ?? Number.MAX_SAFE_INTEGER,
      statuses.length,
      JSON.stringify(statuses),
      limit + 1,
    ) as unknown as RunRow[];
    const runs = rows.slice(0, limit).map(toRun);
    const last = runs.at(-1);
    const counts: Record<RunTab, number> = { all: 0, finished: 0, failed: 0, skipped: 0 };
    for (const row of this.#statements.counts.all(automationId) as {
      status: RunStatus;
      count: number;
    }[]) {
      counts.all += row.count;
      for (const [name, listed] of Object.entries(RUN_TAB_STATUSES)) {
        if (listed.includes(row.status)) counts[name as RunTab] += row.count;
      }
    }
    return { runs, ...(rows.length > limit && last ? { next: last.number } : {}), counts };
  }

  #setFiles(id: string, files: readonly string[]): void {
    this.#statements.clearFiles.run(id);
    for (const file of files) this.#statements.addFile.run(id, file);
  }

  #stored({ task, trigger, rules }: AutomationFields): Stored {
    return { task, trigger, rules };
  }

  #published(id: string): AutomationRecord {
    const automation = this.get(id);
    if (automation === undefined) throw new Error(`No automation "${id}".`);
    this.#publish({ type: "automation", automation });
    return automation;
  }

  #toAutomation(row: AutomationRow): AutomationRecord {
    const stored = JSON.parse(row.fields) as Stored;
    const latest = this.#statements.latestRun.get(row.ref) as RunRow | undefined;
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      ...stored,
      ...(row.paused === null ? {} : { paused: JSON.parse(row.paused) as AutomationPause }),
      ...(row.nextRunAt === null ? {} : { nextRunAt: iso(row.nextRunAt) }),
      ...(latest === undefined ? {} : { latestRun: toRun(latest) }),
      failures: row.failures,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}
