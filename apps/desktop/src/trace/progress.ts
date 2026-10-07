import type { SessionRecord } from "@office-town/contract";
import type { Trace, TraceAction } from "./trace.ts";

// "idle": a session still open after its turn finished, ready for another message.
export type AgentState =
  | "starting"
  | "working"
  | "waiting"
  | "idle"
  | "done"
  | "failed"
  | "stopped"
  | "interrupted";

export interface Progress {
  // The step in progress, or else the first one not done.
  step?: { number: number; title: string };
  stepCount: number;
  stepsDone: number;
  // The latest action still running, a sub-agent's included.
  current?: TraceAction;
  // Newest first.
  recent: TraceAction[];
}

const RECENT = 3;
const cache = new WeakMap<Trace, Progress>();

export function progressOf(trace: Trace): Progress {
  const cached = cache.get(trace);
  if (cached !== undefined) return cached;
  const actions = [...trace.items.values()].filter((item) => item.kind === "action");
  const index = trace.plan.findIndex((step) => step.status === "in_progress");
  const stepIndex =
    index === -1 ? trace.plan.findIndex((step) => step.status !== "completed") : index;
  const step = trace.plan[stepIndex];
  const current = actions.findLast((action) => action.status === "running");
  const progress: Progress = {
    stepCount: trace.plan.length,
    stepsDone: trace.plan.filter((step) => step.status === "completed").length,
    recent: actions.slice(-RECENT).reverse(),
    ...(step === undefined ? {} : { step: { number: stepIndex + 1, title: step.title } }),
    ...(current === undefined ? {} : { current }),
  };
  cache.set(trace, progress);
  return progress;
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
      if (trace === undefined || trace.turnOpen || progressOf(trace).current !== undefined) {
        return "working";
      }
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
