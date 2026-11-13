import type { SessionRecord } from "@office-town/contract";
import { subAgentsOf } from "./sub-agents.ts";
import type { Trace, TraceAction } from "./trace.ts";

// "idle": a session still open after its turn finished, ready for another message.
// "background": its turn ended with its own sub-agents still at work.
export type AgentState =
  | "starting"
  | "working"
  | "background"
  | "waiting"
  | "idle"
  | "done"
  | "failed"
  | "stopped"
  | "interrupted";

export interface Progress {
  // The step in progress, or else the first one not done. None once the plan goes stale.
  step?: { number: number; title: string };
  stepCount: number;
  stepsDone: number;
  // The latest action still running, a sub-agent's included.
  current?: TraceAction;
  // Newest first.
  recent: TraceAction[];
  // The agent's own sub-agents still at work, top level only, oldest first.
  subAgents: TraceAction[];
}

export const isBusy = (state: AgentState) =>
  state === "working" || state === "starting" || state === "background";

const RECENT = 3;
// Past this, an agent has stopped keeping its plan, so the step it names is no longer true.
const STALE_PLAN_ACTIONS = 25;
const cache = new WeakMap<Trace, Progress>();

export function planIsStale(trace: Trace): boolean {
  return (
    trace.actionsSincePlan > STALE_PLAN_ACTIONS &&
    trace.plan.some((step) => step.status !== "completed")
  );
}

export function progressOf(trace: Trace): Progress {
  const cached = cache.get(trace);
  if (cached !== undefined) return cached;
  const actions = [...trace.items.values()].filter((item) => item.kind === "action");
  const index = trace.plan.findIndex((step) => step.status === "in_progress");
  const stepIndex =
    index === -1 ? trace.plan.findIndex((step) => step.status !== "completed") : index;
  const step = planIsStale(trace) ? undefined : trace.plan[stepIndex];
  const current = actions.findLast((action) => action.status === "running");
  const progress: Progress = {
    stepCount: trace.plan.length,
    stepsDone: trace.plan.filter((step) => step.status === "completed").length,
    recent: actions.slice(-RECENT).reverse(),
    subAgents: subAgentsOf(trace).filter((action) => action.status === "running"),
    ...(step === undefined ? {} : { step: { number: stepIndex + 1, title: step.title } }),
    ...(current === undefined ? {} : { current }),
  };
  cache.set(trace, progress);
  return progress;
}

// Where a turn stands before its first output, as a restart and a big session can take a minute.
export function stageOf(state: AgentState, trace: Trace | undefined): string | undefined {
  if (state === "starting") return "Starting the provider";
  if (state !== "working" || trace === undefined || !trace.turnOpen) return undefined;
  if (trace.thinking !== undefined) return "Thinking";
  return trace.answered ? undefined : "Waiting for the model";
}

export function agentState(
  session: SessionRecord,
  trace: Trace | undefined,
  waiting: boolean,
): AgentState {
  if (waiting) return "waiting";
  switch (session.status) {
    case "starting":
      return "starting";
    case "running": {
      if (trace === undefined || trace.turnOpen) return "working";
      const progress = progressOf(trace);
      if (progress.subAgents.length > 0) return "background";
      if (progress.current !== undefined) return "working";
      return trace.lastTurn === "failed" ? "failed" : "idle";
    }
    case "exited":
      return "done";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "interrupted":
      return "interrupted";
  }
}
