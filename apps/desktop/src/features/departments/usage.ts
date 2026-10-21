import type { TaskUsage } from "@office-town/contract";
import type { TokenTotals, Trace } from "../../trace/trace.ts";
import { compactCount } from "../../ui/format.ts";

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

// Cached input is shown apart, so the figure is not inflated (D-29).
export function newTokens({ inputTokens, outputTokens, cachedInputTokens }: TokenTotals): number {
  return inputTokens - cachedInputTokens + outputTokens;
}

// What this goal used on one AI app. A plan's limit is the whole account's, so it is not shown here.
export function tokenSummary(usage: TaskUsage, name: string): string {
  return `${name} ${compactCount(newTokens(usage))} tokens`;
}
