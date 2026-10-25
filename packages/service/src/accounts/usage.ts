import type { AccountUsage, ModelUsage } from "@office-town/contract";

// One row per account and agent, its models' tokens added up. Each model is priced on its own,
// and a row with any unpriced model gets no estimate rather than one that is too low.
export function estimatedUsage(
  rows: readonly ModelUsage[],
  priceOf: (row: ModelUsage) => number | undefined,
): AccountUsage[] {
  const merged = new Map<string, AccountUsage>();
  const unpriced = new Set<string>();
  for (const modelRow of rows) {
    const { model: _, ...row } = modelRow;
    const key = `${row.accountId}\n${row.agentId}`;
    const price = priceOf(modelRow);
    if (price === undefined) unpriced.add(key);
    const earlier = merged.get(key);
    merged.set(key, {
      ...row,
      tasks: row.tasks + (earlier?.tasks ?? 0),
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
