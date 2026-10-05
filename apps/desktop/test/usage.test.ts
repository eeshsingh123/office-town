import type { SessionRecord, UsageLimit } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { usageByHarness } from "../src/features/departments/usage.ts";
import { emptyTrace, type Trace } from "../src/trace/trace.ts";

const session = (id: string, createdAt: string): SessionRecord => ({
  id,
  taskId: "task",
  agentId: id,
  options: { harness: "claude", environment: { kind: "native" }, permissionMode: "ask" },
  status: "exited",
  createdAt,
});

const traced = (id: string, inputTokens: number, limit?: [number, string]): Trace => {
  const trace = emptyTrace(id);
  trace.usage = { inputTokens, outputTokens: 0, cachedInputTokens: 0 };
  if (limit !== undefined) {
    const used: UsageLimit = { id: "five_hour", label: "5-hour", usedFraction: limit[0] };
    trace.limits = [used];
    trace.limitsAt = limit[1];
  }
  return trace;
};

describe("usage", () => {
  it("counts the goal's own tokens, with the plan limit its harness reported last anywhere", () => {
    // The lead started first but reported last; another goal's session reported later still.
    const lead = session("lead", "2026-10-05T14:00:00Z");
    const worker = session("worker", "2026-10-05T14:05:00Z");
    const elsewhere = session("elsewhere", "2026-10-05T15:00:00Z");
    const traces = {
      lead: traced("lead", 100, [0.6, "2026-10-05T14:30:00Z"]),
      worker: traced("worker", 50, [0.4, "2026-10-05T14:06:00Z"]),
      elsewhere: traced("elsewhere", 999, [0.7, "2026-10-05T15:10:00Z"]),
    };

    const [claude] = usageByHarness([lead, worker], traces, [lead, worker, elsewhere]);

    expect(claude?.tokens.inputTokens).toBe(150);
    expect(claude?.limits.map((limit) => limit.usedFraction)).toEqual([0.7]);
  });
});
