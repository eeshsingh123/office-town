import type { Trace, TraceAction } from "./trace.ts";

export interface SubAgentDetails {
  prompt?: string;
  type?: string;
  model?: string;
  background: boolean;
}

const textOf = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

// Each provider names a sub-agent's fields its own way, so the first one present wins.
export function subAgentDetails(input: unknown): SubAgentDetails {
  const fields =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const prompt = textOf(fields.prompt) ?? textOf(fields.objective) ?? textOf(fields.message);
  const type = textOf(fields.subagent_type) ?? textOf(fields.agent) ?? textOf(fields.role);
  const model = textOf(fields.model);
  return {
    ...(prompt === undefined ? {} : { prompt }),
    ...(type === undefined ? {} : { type }),
    ...(model === undefined ? {} : { model }),
    background: fields.run_in_background === true || fields.background === true,
  };
}

// Every step it took, its own sub-agents' included.
export function stepCount(trace: Trace, action: TraceAction): number {
  return action.children.reduce((count, id) => {
    const child = trace.items.get(id);
    return child?.kind === "action" ? count + 1 + stepCount(trace, child) : count;
  }, 0);
}

// The step it is on now, deepest first.
export function currentStep(trace: Trace, action: TraceAction): TraceAction | undefined {
  for (const id of [...action.children].reverse()) {
    const child = trace.items.get(id);
    if (child?.kind !== "action" || child.status !== "running") continue;
    return currentStep(trace, child) ?? child;
  }
  return undefined;
}

// Every sub-agent the agent started, top level only, oldest first.
export function subAgentsOf(trace: Trace): TraceAction[] {
  return trace.order.flatMap((id) => {
    const item = trace.items.get(id);
    return item?.kind === "action" && item.subAgent ? [item] : [];
  });
}
