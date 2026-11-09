import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MessageOrigin, SessionEvent, SessionRecord } from "@office-town/contract";
import { environmentPath } from "@office-town/harness";
import { sessionOptionsFor } from "../agents/options.ts";
import type { Message } from "../registry/session-registry.ts";
import { eventsOf, userMessages } from "../store/session-events.ts";
import type { Store } from "../store/store.ts";
import { LEAD_BRIEF_SUMMARY } from "./briefs.ts";
import { handoverFolder } from "./handover-files.ts";
import type { TeamContext } from "./members.ts";

export type HandoverRole = "worker" | "lead" | "chief" | "solo";

// What the agent wrote while its cache was warm (owner, D-94).
export interface Handover {
  decisions: string[];
  facts: string[];
  next: string;
  files: string[];
  // Its step list as it stands, so the new session writes it again first (D-83).
  steps: string[];
  // A worker's piece, or where each part of the chief's plan stands.
  progress?: string;
}

const SHOWN_BRIEF = 600;
// A tool's output in the earlier conversation's file: errors and test lines come first, and the
// whole of a file read stays on disk.
const SHOWN_RESULT = 2_000;
const TRAFFIC = new Set<MessageOrigin["kind"]>(["result", "notice", "piece"]);

function list(title: string, items: string[]): string {
  return items.length === 0 ? "" : `\n\n${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function shortened(text: string, length = SHOWN_BRIEF): string {
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

// Tools run side by side, so an output names the action it came from.
function transcriptLine(
  event: SessionEvent,
  name: string,
  titles: Map<string, string>,
): string | undefined {
  switch (event.type) {
    case "message": {
      const { role, text, origin } = event.payload;
      if (role === "assistant") return `### ${name}\n\n${text}`;
      return `### ${origin === undefined ? "The user" : `Office Town (${origin.kind})`}\n\n${text}`;
    }
    case "action.started":
      titles.set(event.payload.actionId, event.payload.title);
      return `- ${event.payload.title}`;
    case "action.ended": {
      const { actionId, outcome, result } = event.payload;
      if (result.trim() === "") return undefined;
      const label = outcome === "failed" ? "Failed" : "Output";
      const title = titles.get(actionId) ?? "a tool";
      return `${label} of ${title}:\n\n\`\`\`\`\n${shortened(result, SHOWN_RESULT)}\n\`\`\`\``;
    }
    case "permission.requested":
      return `- Asked the user: ${event.payload.title}`;
    case "permission.resolved":
      return `- The user's answer: ${event.payload.optionId ?? event.payload.outcome}`;
    default:
      return undefined;
  }
}

export function transcriptOf(sessions: SessionEvent[][], name: string): string {
  const titles = new Map<string, string>();
  return sessions
    .flat()
    .flatMap((event) => transcriptLine(event, name, titles) ?? [])
    .join("\n\n");
}

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

// The note's fields in order, left out when empty.
function sectionsOf(handover: Handover): [string, string][] {
  const sections: [string, string | undefined][] = [
    ["Decisions, with why", bullets(handover.decisions)],
    ["What was learned", bullets(handover.facts)],
    ["Where the part stands", handover.progress],
    ["What comes next", handover.next],
    ["Step list", bullets(handover.steps)],
    ["Files to know", bullets(handover.files)],
  ];
  return sections.flatMap(([title, body]) => (body ? [[title, body] as [string, string]] : []));
}

export function handoverText(handover: Handover): string {
  return sectionsOf(handover)
    .map(([title, body]) => `\n\n${title}:\n${body}`)
    .join("");
}

const handoverMarkdown = (handover: Handover) =>
  sectionsOf(handover)
    .map(([title, body]) => `### ${title}\n\n${body}`)
    .join("\n\n");

// The agent's sessions in the task, oldest first: one conversation carried across handovers.
export function sessionsOfAgent(store: Store, taskId: string, agentId: string): SessionRecord[] {
  return store.listSessions(taskId).filter((session) => session.agentId === agentId);
}

// What it was briefed with: a lead's latest brief, else the first message of its conversation.
function briefOf(role: HandoverRole, events: SessionEvent[]): string | undefined {
  const sent = userMessages(events);
  const lead =
    role === "lead"
      ? sent.findLast(
          ({ origin }) => origin?.kind === "brief" && origin.summary === LEAD_BRIEF_SUMMARY,
        )
      : undefined;
  return (lead ?? sent[0])?.text;
}

// A worker's first brief names its first piece; the new session reads the piece it is on.
function withCurrentPiece(store: Store, old: SessionRecord, brief: string): string {
  const piece = store.workingDelegation(old.id);
  const first = store
    .listDelegations(old.taskId)
    .find((delegation) => delegation.workerAgentId === old.agentId);
  if (piece === undefined || first === undefined || first.brief === piece.brief) return brief;
  return brief.replace(first.brief, () => piece.brief);
}

function piecesHandedOut(store: Store, taskId: string): string[] {
  return store.listDelegations(taskId).map((delegation) => {
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const open = delegation.status === "working";
    const brief = open ? delegation.brief : shortened(delegation.brief);
    const result = delegation.result ? `\n  Result: ${delegation.result}` : "";
    return `${name}, ${open ? "still working" : delegation.status}:\n  Brief: ${brief}${result}`;
  });
}

function ownPieces(store: Store, taskId: string, agentId: string): string[] {
  return store
    .listDelegations(taskId)
    .filter((delegation) => delegation.workerAgentId === agentId)
    .map((delegation) => {
      const open = delegation.status === "working";
      const result = delegation.result ? `\n  Your result: ${delegation.result}` : "";
      return `${open ? "Your piece now" : `An earlier piece, ${delegation.status}`}:\n  ${delegation.brief}${result}`;
    });
}

function planParts(store: Store, taskId: string): string[] {
  return store.listPieces(taskId).map((piece) => {
    const department =
      piece.departmentId === undefined ? "" : ` (${store.getDepartment(piece.departmentId)?.name})`;
    const result = piece.result ? `\n  Result: ${shortened(piece.result)}` : "";
    return `${piece.title}${department}, ${piece.status}${result}`;
  });
}

// From the records, so nothing the user said or anyone returned rests on the agent's memory.
function recordsOf(
  store: Store,
  role: HandoverRole,
  session: SessionRecord,
  events: SessionEvent[],
): string {
  const sent = userMessages(events);
  const said = sent.flatMap(({ text, origin }) => {
    if (origin === undefined) return [`You were told: ${text}`];
    if (origin.kind === "answer") return [`The user's answer to a question: ${text}`];
    return [];
  });
  const told = sent
    .slice(1)
    .flatMap(({ text, origin }) =>
      origin?.kind === "brief" || origin?.kind === "message" ? [text] : [],
    );
  const own = {
    lead: list("Work handed out", piecesHandedOut(store, session.taskId)),
    worker: `${list("Your pieces of work", ownPieces(store, session.taskId, session.agentId))}${list("Messages your lead sent since", told)}`,
    chief: list("Your plan's parts", planParts(store, session.taskId)),
    solo: "",
  }[role];
  return `${list("What the user told you", said)}${own}`;
}

const CARRY_ON: Record<HandoverRole, string> = {
  lead: "Workers' results keep reaching you as messages.",
  worker:
    "It is the same piece of work: finish it, and your last message goes to your lead as before.",
  chief: "Departments' results keep reaching you as messages.",
  solo: "",
};

async function writeHandoverFile(
  context: TeamContext,
  old: SessionRecord,
  name: string,
  handover: Handover,
  sessions: SessionEvent[][],
): Promise<string> {
  const folder = handoverFolder(context.dataFolder, old.taskId);
  const file = join(folder, `${old.id}.md`);
  await mkdir(folder, { recursive: true });
  const written = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  await writeFile(
    file,
    `# ${name}'s handover\n\n${written}\n\n## What it handed over\n\n${handoverMarkdown(handover)}\n\n## Earlier conversation\n\n${transcriptOf(sessions, name)}\n`,
  );
  return file;
}

// Starts the new session in the same folders, then moves a worker's piece to it, before the old
// one stops: a message or result never wakes the old one, and its end never reads as a failure.
// Undefined when the new session could not start; the old one was told to carry on.
export async function carryOver(
  context: TeamContext,
  old: SessionRecord,
  role: HandoverRole,
  handover: Handover,
): Promise<SessionRecord | undefined> {
  const { store, registry } = context;
  const agent = store.getAgent(old.agentId);
  if (agent === undefined) return undefined;
  const sessions = sessionsOfAgent(store, old.taskId, old.agentId).map((session) =>
    eventsOf(store, session.id),
  );
  const events = sessions.flat();
  const brief = briefOf(role, events);
  if (brief === undefined) return undefined;
  const file = await writeHandoverFile(context, old, agent.name, handover, sessions);
  const folder = handoverFolder(context.dataFolder, old.taskId);
  const { environment, workspacePath, additionalPaths = [], readOnlyPaths = [] } = old.options;
  const seen = environment === undefined ? file : environmentPath(environment, file);
  const opening = role === "worker" ? withCurrentPiece(store, old, brief) : brief;
  const text = `${opening}

You carry on from your earlier session on this task: it grew long, so a new session continues with a complete handover. Your folders and files are as you left them. Programs left running stopped with the earlier session; start again any you need.

What you handed over:${handoverText(handover)}

What the records say:${recordsOf(store, role, old, events)}

The earlier conversation is in ${seen}. If a detail you need is missing here, search that file; do not read it whole.

Say in a few lines where things stand. If you keep a todo list, write it again first from where you are, then carry on. ${CARRY_ON[role]}`;
  const origin: MessageOrigin = { kind: "handover", fromSessionId: old.id };
  const message: Message = { text: text.trimEnd(), origin };
  const piece = store.workingDelegation(old.id);
  try {
    const next = await registry.start({
      taskId: old.taskId,
      agentId: old.agentId,
      options: sessionOptionsFor(store, agent, {
        workspacePath,
        additionalPaths,
        readOnlyPaths: [...new Set([...readOnlyPaths, folder])],
      }),
      message,
    });
    if (next.status !== "starting" && next.status !== "running") {
      throw new Error("it ended at once");
    }
    if (piece !== undefined) store.moveDelegation(piece.id, next.id);
    return next;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await registry.tell(old.id, {
      text: `The new session could not start (${reason}). Carry on here.`,
      origin: { kind: "notice", summary: "The new session could not start" },
    });
    return undefined;
  }
}

// Whether the user asked for it: the last word from a person, past the task itself, results and
// news, was theirs.
export function userAsked(store: Store, session: SessionRecord): boolean {
  const events = sessionsOfAgent(store, session.taskId, session.agentId).flatMap((one) =>
    eventsOf(store, one.id),
  );
  const last = userMessages(events)
    .slice(1)
    .findLast(({ origin }) => origin === undefined || !TRAFFIC.has(origin.kind));
  return last !== undefined && (last.origin === undefined || last.origin.kind === "answer");
}
