import type { AccountLimits, SessionRecord, TaskUsage, UsageLimit } from "@office-town/contract";
import type { TokenTotals, Trace } from "../../trace/trace.ts";
import { compactCount } from "../../ui/format.ts";
import { sessionAccountId } from "../usage/limits.ts";

export interface HarnessUsage {
  harness: string;
  // Empty where the harness reports none (D-29).
  limits: UsageLimit[];
  tokens: TokenTotals;
}

const NO_TOKENS: TokenTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

export function totalOf(usage: readonly TokenTotals[]): TokenTotals {
  return usage.reduce(
    (total, one) => ({
      inputTokens: total.inputTokens + one.inputTokens,
      outputTokens: total.outputTokens + one.outputTokens,
      cachedInputTokens: total.cachedInputTokens + one.cachedInputTokens,
    }),
    NO_TOKENS,
  );
}

export function sumUsage(traces: readonly Trace[]): TokenTotals {
  return totalOf(traces.map((trace) => trace.usage));
}

// With the limits of the account its latest session ran on, since a limit belongs to the account.
export function usageByHarness(
  sessions: readonly SessionRecord[],
  usage: readonly TaskUsage[],
  limits: Record<string, AccountLimits>,
): HarnessUsage[] {
  return [...new Set(sessions.map((session) => session.options.harness))]
    .sort((a, b) => a.localeCompare(b))
    .map((harness) => {
      const latest = sessions.findLast((session) => session.options.harness === harness);
      const accountId = latest === undefined ? harness : sessionAccountId(latest.options);
      return {
        harness,
        limits: limits[accountId]?.limits ?? [],
        tokens: usage.find((one) => one.harness === harness) ?? NO_TOKENS,
      };
    });
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
