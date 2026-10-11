import { taskTitle } from "../ui/format.ts";
import { describeActions } from "./blocks.ts";
import type { Trace, TraceAction, TraceMessage } from "./trace.ts";

export interface ActivityGroup {
  id: string;
  title: string;
  state: "done" | "now" | "next";
  at?: string;
  // What it did, then what it is doing.
  done?: string;
  running?: string;
}

function openGroup(id: string, title: string, at?: string) {
  return { id, title, at, actions: [] as TraceAction[], replied: false };
}

type Open = ReturnType<typeof openGroup>;

function finish(group: Open, now: boolean): ActivityGroup {
  const finished = group.actions.filter((action) => action.status !== "running");
  const running = group.actions.findLast((action) => action.status === "running");
  const done =
    finished.length > 0 ? describeActions(finished) : group.replied ? "Replied" : undefined;
  return {
    id: group.id,
    title: group.title,
    state: now ? "now" : "done",
    ...(group.at === undefined ? {} : { at: group.at }),
    ...(done === undefined ? {} : { done }),
    ...(now && running !== undefined ? { running: running.title } : {}),
  };
}

// The core puts the user's words after the agent's instructions under this line (briefs.ts).
const TASK_LINE = "\nYour task:\n";

// A message that starts new work: the user's own, a brief, or another agent's message.
function startTitle(message: TraceMessage): string | undefined {
  if (message.role !== "user") return undefined;
  const asked = taskTitle(message.text.split(TASK_LINE).at(-1) ?? message.text);
  switch (message.origin?.kind) {
    case undefined:
      return `You asked: ${asked}`;
    case "brief":
      // Without a sender it is the user's own task, sent with their profile.
      return message.origin.from === undefined ? `You asked: ${asked}` : `Brief: ${asked}`;
    case "message":
      return `Message: ${asked}`;
    default:
      return undefined;
  }
}

function byStep(traces: readonly Trace[], live: boolean): ActivityGroup[] {
  const plan = traces.findLast((trace) => trace.plan.length > 0)?.plan ?? [];
  const actions = traces.flatMap((trace) =>
    trace.order.flatMap((id) => {
      const item = trace.items.get(id);
      return item?.kind === "action" ? [item] : [];
    }),
  );
  return plan.map((step) => {
    const group = openGroup(step.id, step.title);
    group.actions = actions.filter((action) => action.planStepId === step.id);
    group.at = group.actions[0]?.startedAt;
    if (step.status === "pending" && group.actions.length === 0) {
      return { id: step.id, title: step.title, state: "next" };
    }
    const finished = finish(group, live && step.status === "in_progress");
    return step.status === "completed" ? { ...finished, state: "done" } : finished;
  });
}

function byMessage(traces: readonly Trace[], live: boolean): ActivityGroup[] {
  const groups: Open[] = [];
  for (const trace of traces) {
    for (const id of trace.order) {
      const item = trace.items.get(id);
      if (item?.kind === "message") {
        const title = startTitle(item);
        if (title !== undefined) groups.push(openGroup(item.id, title, item.at));
        else if (item.role === "assistant") {
          const last = groups.at(-1);
          if (last !== undefined) last.replied = true;
        }
        continue;
      }
      if (item?.kind !== "action") continue;
      const last = groups.at(-1) ?? openGroup(item.id, "Started", item.startedAt);
      if (groups.length === 0) groups.push(last);
      last.actions.push(item);
    }
  }
  const working = live && (traces.at(-1)?.turnOpen ?? false);
  return groups.map((group, index) => finish(group, working && index === groups.length - 1));
}

// The agent's own steps when it made a list; otherwise its work under each message that started it.
export function activityOf(traces: readonly Trace[], live: boolean): ActivityGroup[] {
  const planned = traces.some((trace) => trace.plan.length > 0);
  return planned ? byStep(traces, live) : byMessage(traces, live);
}
