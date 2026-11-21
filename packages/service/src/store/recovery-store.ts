import type { DatabaseSync, StatementSync } from "node:sqlite";

const queries = {
  markDelegationRetried: "UPDATE delegations SET retried = 1 WHERE id = ?",
  delegationRetried: "SELECT 1 FROM delegations WHERE id = ? AND retried = 1",
  setLeadRetriedAt: "UPDATE tasks SET lead_retried_at = ? WHERE id = ?",
  leadRetriedAt: "SELECT lead_retried_at AS at FROM tasks WHERE id = ?",
  countResumeAttempt: "UPDATE tasks SET resume_attempts = resume_attempts + 1 WHERE id = ?",
  clearResumeAttempts: "UPDATE tasks SET resume_attempts = 0 WHERE id = ? AND resume_attempts > 0",
  resumeAttempts: "SELECT resume_attempts AS attempts FROM tasks WHERE id = ?",
  oweResult: "UPDATE delegations SET owed = 1 WHERE id = ?",
  resultDelivered: "UPDATE delegations SET owed = 0 WHERE id = ? AND owed = 1",
  owedResults: `
    SELECT g.id FROM delegations g JOIN tasks t ON t.ref = g.task_ref
    WHERE t.id = ? AND g.owed = 1 AND g.status != 'working'
    ORDER BY g.ended_at, g.ref`,
};

// The one automatic retry (D-77) and the results a lead never got, kept across a restart (D-120).
export class RecoveryStore {
  readonly #statements: Record<keyof typeof queries, StatementSync>;

  constructor(db: DatabaseSync) {
    this.#statements = Object.fromEntries(
      Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql)]),
    ) as Record<keyof typeof queries, StatementSync>;
  }

  markDelegationRetried(delegationId: string): void {
    this.#statements.markDelegationRetried.run(delegationId);
  }

  delegationRetried(delegationId: string): boolean {
    return this.#statements.delegationRetried.get(delegationId) !== undefined;
  }

  // When the lead's retry was sent; cleared once a lead turn completes.
  setLeadRetriedAt(taskId: string, at: number | undefined): void {
    this.#statements.setLeadRetriedAt.run(at ?? null, taskId);
  }

  leadRetriedAt(taskId: string): number | undefined {
    const row = this.#statements.leadRetriedAt.get(taskId) as { at: number | null } | undefined;
    return row?.at ?? undefined;
  }

  // Written before a resume after a restart runs; cleared once its top agent finishes a turn.
  countResumeAttempt(taskId: string): void {
    this.#statements.countResumeAttempt.run(taskId);
  }

  clearResumeAttempts(taskId: string): void {
    this.#statements.clearResumeAttempts.run(taskId);
  }

  resumeAttempts(taskId: string): number {
    const row = this.#statements.resumeAttempts.get(taskId) as { attempts: number } | undefined;
    return row?.attempts ?? 0;
  }

  // Set before the result is sent; cleared once the lead's session records it.
  oweResult(delegationId: string): void {
    this.#statements.oweResult.run(delegationId);
  }

  resultDelivered(delegationId: string): void {
    this.#statements.resultDelivered.run(delegationId);
  }

  // The ended delegations whose result the lead never got, oldest end first.
  owedResults(taskId: string): string[] {
    return this.#statements.owedResults.all(taskId).map((row) => (row as { id: string }).id);
  }
}
