import type { SessionRecord, UsageLimit } from "@office-town/contract";
import type { TokenTotals, Trace } from "../../trace/trace.ts";
import { compactCount } from "../../ui/format.ts";

export interface HarnessUsage {
  harness: string;
  // The harness's own plan limits, the latest known; empty where it reports none (D-29).
  limits: UsageLimit[];
  tokens: TokenTotals;
}

export function sumUsage(traces: readonly Trace[]): TokenTotals {
  return traces.reduce(
    (total, { usage }) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  );
}

// A plan limit belongs to the account, not to one goal, so it is the newest that any loaded
// session of the harness reported.
function latestLimits(
  harness: string,
  everySession: readonly SessionRecord[],
  traces: Record<string, Trace>,
): UsageLimit[] {
  let latest: Trace | undefined;
  for (const session of everySession) {
    const trace = traces[session.id];
    if (session.options.harness !== harness || trace?.limitsAt === undefined) continue;
    if (latest?.limitsAt === undefined || trace.limitsAt > latest.limitsAt) latest = trace;
  }
  return latest?.limits ?? [];
}

// Tokens of these sessions by harness, from the traces loaded for them, with each harness's limit.
export function usageByHarness(
  sessions: readonly SessionRecord[],
  traces: Record<string, Trace>,
  everySession: readonly SessionRecord[],
): HarnessUsage[] {
  const byHarness = Map.groupBy(sessions, (session) => session.options.harness);
  return [...byHarness]
    .map(([harness, group]) => ({
      harness,
      limits: latestLimits(harness, everySession, traces),
      tokens: sumUsage(group.flatMap((session) => traces[session.id] ?? [])),
    }))
    .sort((a, b) => a.harness.localeCompare(b.harness));
}

// New tokens only: cached input is shown apart, so the figure is not inflated (D-29).
export function newTokens({ inputTokens, outputTokens, cachedInputTokens }: TokenTotals): number {
  return inputTokens - cachedInputTokens + outputTokens;
}

// A few words for a room's sign: the harness's fullest limit, or else its tokens.
export function usageSummary(usage: HarnessUsage, name: string): string {
  const fullest = usage.limits.toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
  if (fullest !== undefined) return `${name} ${Math.round(fullest.usedFraction * 100)}%`;
  return `${name} ${compactCount(newTokens(usage.tokens))} tokens`;
}
