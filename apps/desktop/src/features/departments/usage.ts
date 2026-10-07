import type { HarnessLimits, SessionRecord, TaskUsage, UsageLimit } from "@office-town/contract";
import type { TokenTotals, Trace } from "../../trace/trace.ts";
import { compactCount } from "../../ui/format.ts";

export interface HarnessUsage {
  harness: string;
  // Empty where the harness reports none (D-29).
  limits: UsageLimit[];
  tokens: TokenTotals;
}

const NO_TOKENS: TokenTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

export function sumUsage(traces: readonly Trace[]): TokenTotals {
  return traces.reduce(
    (total, { usage }) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    }),
    NO_TOKENS,
  );
}

// From the agent's loaded traces: the core sums tokens per task only.
export function tracedUsage(
  sessions: readonly SessionRecord[],
  traces: Record<string, Trace>,
): TaskUsage[] {
  return [...Map.groupBy(sessions, (session) => session.options.harness)].map(
    ([harness, group]) => ({
      harness,
      ...sumUsage(group.flatMap((session) => traces[session.id] ?? [])),
    }),
  );
}

// With the newest plan limits the core keeps, since a limit belongs to the account.
export function usageByHarness(
  sessions: readonly SessionRecord[],
  usage: readonly TaskUsage[],
  limits: Record<string, HarnessLimits>,
): HarnessUsage[] {
  return [...new Set(sessions.map((session) => session.options.harness))]
    .sort((a, b) => a.localeCompare(b))
    .map((harness) => ({
      harness,
      limits: limits[harness]?.limits ?? [],
      tokens: usage.find((one) => one.harness === harness) ?? NO_TOKENS,
    }));
}

// Cached input is shown apart, so the figure is not inflated (D-29).
export function newTokens({ inputTokens, outputTokens, cachedInputTokens }: TokenTotals): number {
  return inputTokens - cachedInputTokens + outputTokens;
}

// The harness's fullest limit, or else its tokens.
export function usageSummary(usage: HarnessUsage, name: string): string {
  const fullest = usage.limits.toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
  if (fullest !== undefined) return `${name} ${Math.round(fullest.usedFraction * 100)}%`;
  return `${name} ${compactCount(newTokens(usage.tokens))} tokens`;
}
