import type { DelegationRecord } from "@office-town/contract";
import { describeActions } from "../../trace/blocks.ts";
import { type FileUse, fileUses } from "../../trace/file-uses.ts";
import type { ShownInput } from "../../trace/team-tools.ts";
import type { Trace, TraceAction, TraceMessage } from "../../trace/trace.ts";

export type ThreadState = "working" | "done" | "failed" | "stopped";

// The brief a lead handed over, then the result it got back.
export interface DelegationThread {
  kind: "delegation";
  id: string;
  delegationId?: string;
  workerId: string | undefined;
  workerName: string | undefined;
  brief: string;
  state: ThreadState;
  result?: string;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string; at: string; files?: FileUse[] }
  | { kind: "agent"; id: string; text: string; at: string }
  // A brief, or another agent's message.
  | {
      kind: "passed";
      id: string;
      text: string;
      at: string;
      from?: string;
      brief: boolean;
      files?: FileUse[];
    }
  | { kind: "notice"; id: string; text: string }
  // A run of tool calls between messages, in one line.
  | { kind: "work"; id: string; text: string }
  // A result the agent showed, by what it showed in the session's task (M8).
  | { kind: "result"; id: string; sessionId: string; shows: ShownInput }
  | DelegationThread
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

function itemOf(message: TraceMessage, files: FileUse[] | undefined): ChatItem | undefined {
  const { id, text, at, origin } = message;
  const given = files === undefined ? {} : { files };
  if (origin === undefined) {
    return message.role === "user"
      ? { kind: "user", id, text, at, ...given }
      : { kind: "agent", id, text, at };
  }
  switch (origin.kind) {
    case "brief":
      return {
        kind: "passed",
        id,
        text,
        at,
        brief: true,
        ...(origin.from ? { from: origin.from } : {}),
        ...given,
      };
    case "message":
      return { kind: "passed", id, text, at, brief: false, from: origin.from, ...given };
    case "notice":
      return { kind: "notice", id, text: origin.summary };
    case "piece":
      return { kind: "handoff", id, pieceId: origin.pieceId, state: origin.outcome, result: text };
    case "result":
    case "answer":
      return undefined;
  }
}

export interface ChatContext {
  idOfName: (name: string) => string | undefined;
  delegations: readonly DelegationRecord[];
  // A thread with no result and no record will not get one.
  ended: boolean;
}

// A delegation and its result are one thread; a result whose record the app lacks takes the oldest open one.
export function chatOf(traces: readonly Trace[], context: ChatContext): ChatItem[] {
  const items: ChatItem[] = [];
  const threads: DelegationThread[] = [];
  const unlinked = [...context.delegations];
  const known = new Set(context.delegations.map((record) => record.id));
  let run: TraceAction[] = [];
  const flush = () => {
    const [first] = run;
    if (first !== undefined) items.push({ kind: "work", id: first.id, text: describeActions(run) });
    run = [];
  };
  for (const trace of traces) {
    const uses = fileUses(trace);
    for (const id of trace.order) {
      const entry = trace.items.get(id);
      if (entry?.kind === "action" && entry.shows !== undefined && entry.status === "completed") {
        flush();
        items.push({
          kind: "result",
          id: entry.id,
          sessionId: trace.sessionId,
          shows: entry.shows,
        });
        continue;
      }
      if (entry?.kind === "action") {
        const thread = delegationOf(entry, context.idOfName);
        if (thread === undefined) {
          run.push(entry);
          continue;
        }
        flush();
        items.push(thread);
        if (thread.state === "failed") continue;
        const index = unlinked.findIndex(
          (record) => record.workerAgentId === thread.workerId && record.brief === thread.brief,
        );
        const [record] = index === -1 ? [] : unlinked.splice(index, 1);
        if (record !== undefined) thread.delegationId = record.id;
        threads.push(thread);
        continue;
      }
      if (entry?.kind !== "message") continue;
      flush();
      if (entry.origin?.kind === "result") {
        const { delegationId, agentId, outcome } = entry.origin;
        const matched =
          threads.find((one) => one.delegationId === delegationId) ??
          (known.has(delegationId)
            ? undefined
            : threads.find(
                (one) =>
                  one.delegationId === undefined &&
                  one.workerId === agentId &&
                  one.result === undefined,
              ));
        const thread = matched ?? {
          kind: "delegation",
          id,
          delegationId,
          workerId: agentId,
          workerName: undefined,
          brief: "",
          state: outcome,
        };
        if (matched === undefined) {
          threads.push(thread);
          items.push(thread);
        }
        thread.state = outcome;
        thread.result = entry.text;
        continue;
      }
      const item = itemOf(entry, uses.get(id));
      if (item !== undefined) items.push(item);
    }
  }
  flush();
  if (context.ended) {
    for (const thread of threads) {
      const open = thread.state === "working" && thread.result === undefined;
      if (open && thread.delegationId === undefined) thread.state = "stopped";
    }
  }
  return items;
}
