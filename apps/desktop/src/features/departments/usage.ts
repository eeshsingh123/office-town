import type { SessionRecord } from "@office-town/contract";
import type { TokenTotals, Trace } from "../../trace/trace.ts";

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

export interface PersonUsage {
  agentId: string;
  tokens: number;
}

// Each agent's new tokens over the sessions, most first; undefined until every session's trace is
// in, so a partial sum never shows.
export function usageByPerson(
  sessions: readonly SessionRecord[],
  traces: Record<string, Trace>,
): PersonUsage[] | undefined {
  const tokens = new Map<string, number>();
  for (const session of sessions) {
    const trace = traces[session.id];
    if (trace === undefined) return undefined;
    tokens.set(session.agentId, (tokens.get(session.agentId) ?? 0) + newTokens(trace.usage));
  }
  return [...tokens]
    .filter(([, used]) => used > 0)
    .map(([agentId, used]) => ({ agentId, tokens: used }))
    .sort((a, b) => b.tokens - a.tokens);
}
