import type { AccountUsage, TaskModelUsage } from "@office-town/contract";

// One row per account and agent, its tasks counted and their tokens added up. Each model is priced
// on its own, and a row with any unpriced model gets no estimate rather than one that is too low.
export function estimatedUsage(
  rows: readonly TaskModelUsage[],
  priceOf: (row: TaskModelUsage) => number | undefined,
): AccountUsage[] {
  const merged = new Map<string, AccountUsage>();
  const tasks = new Map<string, Set<number>>();
  const unpriced = new Set<string>();
  for (const taskRow of rows) {
    const { task, model: _, ...row } = taskRow;
    const key = `${row.accountId}
${row.agentId}`;
    const price = priceOf(taskRow);
    if (price === undefined) unpriced.add(key);
    const counted = tasks.get(key) ?? new Set();
    if (task !== undefined) counted.add(task);
    tasks.set(key, counted);
    const earlier = merged.get(key);
    merged.set(key, {
      ...row,
      tasks: counted.size,
      inputTokens: row.inputTokens + (earlier?.inputTokens ?? 0),
      outputTokens: row.outputTokens + (earlier?.outputTokens ?? 0),
      cachedInputTokens: row.cachedInputTokens + (earlier?.cachedInputTokens ?? 0),
      estimatedUsd: (earlier?.estimatedUsd ?? 0) + (price ?? 0),
    });
  }
  return [...merged.entries()]
    .map(([key, row]) => {
      if (!unpriced.has(key)) return row;
      const { estimatedUsd: _, ...tokens } = row;
      return tokens;
    })
    .toSorted((a, b) => b.outputTokens - a.outputTokens);
}
