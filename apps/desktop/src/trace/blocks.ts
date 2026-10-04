import type { Trace, TraceAction } from "./trace.ts";

// What the trace view draws, top to bottom: single items, and runs of actions that belong to the
// same plan step. A step's heading shows once, where its work begins.
export type TraceBlock =
  | { kind: "item"; id: string }
  | { kind: "actions"; ids: string[]; stepId: string | undefined; showsStep: boolean };

export function toBlocks(trace: Trace): TraceBlock[] {
  const blocks: TraceBlock[] = [];
  let shownStep: string | undefined;
  for (const id of trace.order) {
    const item = trace.items.get(id);
    if (item?.kind !== "action") {
      blocks.push({ kind: "item", id });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === "actions" && last.stepId === item.planStepId) {
      last.ids.push(id);
      continue;
    }
    const stepId = item.planStepId;
    blocks.push({ kind: "actions", ids: [id], stepId, showsStep: stepId !== shownStep });
    shownStep = stepId ?? shownStep;
  }
  return blocks;
}

const PHRASES: Record<TraceAction["actionKind"], [string, string]> = {
  read: ["read 1 file", "read # files"],
  edit: ["edited 1 file", "edited # files"],
  delete: ["deleted 1 file", "deleted # files"],
  move: ["moved 1 file", "moved # files"],
  search: ["searched once", "searched # times"],
  execute: ["ran 1 command", "ran # commands"],
  fetch: ["fetched 1 page", "fetched # pages"],
  think: ["thought once", "thought # times"],
  delegate: ["delegated 1 task", "delegated # tasks"],
  other: ["used 1 tool", "used # tools"],
};

// One line for a run of actions, such as "Read 2 files, ran 1 command".
export function describeActions(actions: readonly TraceAction[]): string {
  const counts = new Map<TraceAction["actionKind"], number>();
  for (const action of actions) {
    counts.set(action.actionKind, (counts.get(action.actionKind) ?? 0) + 1);
  }
  const text = [...counts]
    .map(([kind, count]) => {
      const [one, many] = PHRASES[kind];
      return count === 1 ? one : many.replace("#", String(count));
    })
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
