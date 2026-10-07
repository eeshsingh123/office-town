import type { Trace, TraceAction, TraceMessage } from "../../trace/trace.ts";

export type ThreadState = "working" | "done" | "failed" | "stopped";

// A lead's piece of work for a worker: the brief it handed over, then the result it got back.
export interface DelegationThread {
  kind: "delegation";
  id: string;
  workerId: string | undefined;
  workerName: string | undefined;
  brief: string;
  state: ThreadState;
  result?: string;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "agent"; id: string; text: string; at: string }
  // Words the core passed on: a brief, or another agent's message.
  | { kind: "passed"; id: string; text: string; at: string; from?: string; brief: boolean }
  | { kind: "notice"; id: string; text: string }
  | DelegationThread
  // A piece of the chief's plan that ended, with its department's result.
  | { kind: "handoff"; id: string; pieceId: string; state: ThreadState; result: string };

function delegationOf(
  action: TraceAction,
  idOfName: (name: string) => string | undefined,
): DelegationThread | undefined {
  if (action.actionKind !== "delegate" || action.input === null) return undefined;
  const { agent, brief } = action.input as Record<string, unknown>;
  if (typeof agent !== "string" || typeof brief !== "string") return undefined;
  return {
    kind: "delegation",
    id: action.id,
    workerId: idOfName(agent),
    workerName: agent,
    brief,
    state: action.status === "failed" ? "failed" : "working",
  };
}

function itemOf(message: TraceMessage): ChatItem | undefined {
  const { id, text, at, origin } = message;
  if (origin === undefined)
    return { kind: message.role === "user" ? "user" : "agent", id, text, at };
  switch (origin.kind) {
    case "brief":
      return {
        kind: "passed",
        id,
        text,
        at,
        brief: true,
        ...(origin.from ? { from: origin.from } : {}),
      };
    case "message":
      return { kind: "passed", id, text, at, brief: false, from: origin.from };
    case "notice":
      return { kind: "notice", id, text: origin.summary };
    case "piece":
      return { kind: "handoff", id, pieceId: origin.pieceId, state: origin.outcome, result: text };
    case "result":
    case "answer":
      return undefined;
  }
}

// One goal's conversation, across its sessions in order. A delegation and the result that answers
// it are one thread, at the place of the delegation; tool calls and nested work stay in the trace.
export function chatOf(
  traces: readonly Trace[],
  idOfName: (name: string) => string | undefined,
): ChatItem[] {
  const items: ChatItem[] = [];
  const threads: DelegationThread[] = [];
  for (const trace of traces) {
    for (const id of trace.order) {
      const entry = trace.items.get(id);
      if (entry?.kind === "action") {
        const thread = delegationOf(entry, idOfName);
        if (thread === undefined) continue;
        threads.push(thread);
        items.push(thread);
        continue;
      }
      if (entry?.kind !== "message") continue;
      if (entry.origin?.kind === "result") {
        const { agentId, outcome } = entry.origin;
        const open = threads.find((one) => one.workerId === agentId && one.result === undefined);
        const thread = open ?? {
          kind: "delegation",
          id,
          workerId: agentId,
          workerName: undefined,
          brief: "",
          state: outcome,
        };
        if (open === undefined) {
          threads.push(thread);
          items.push(thread);
        }
        thread.state = outcome;
        thread.result = entry.text;
        continue;
      }
      const item = itemOf(entry);
      if (item !== undefined) items.push(item);
    }
  }
  return items;
}
