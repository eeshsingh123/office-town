import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent, SessionRecord } from "@office-town/contract";
import { environmentPath } from "@office-town/harness";
import { z } from "zod";
import { sessionOptionsFor } from "../agents/options.ts";
import { AnswerError, type Message } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { LEAD_BRIEF_SUMMARY } from "./briefs.ts";
import { isLead, NOT_YET, teamOf } from "./delegate.ts";
import { leadsTeam } from "./lead.ts";
import type { TeamContext } from "./members.ts";

// Owner: suggested past this, never done on its own (D-72).
export const SUGGEST_AT_TOKENS = 400_000;
const PAGE = 1_000;
const SHOWN_BRIEF = 600;

interface Handover {
  decisions: string[];
  facts: string[];
  next: string;
  files: string[];
}

export function eventsOf(store: Store, sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.readEvents({ after, limit: PAGE, sessionId });
    events.push(...page.map((stored) => stored.event));
    if (page.length < PAGE) return events;
    after = page.at(-1)?.position ?? after;
  }
}

export const userMessages = (events: SessionEvent[]) =>
  events.flatMap((event) =>
    event.type === "message" && event.payload.role === "user" ? [event.payload] : [],
  );

const TRAFFIC = new Set(["result", "notice", "piece"]);

// The last word from a person, past workers' results and news, was the user's: a lead never hands
// over on its own. Or the user took the app's suggestion.
function userAsked(store: Store, sessionId: string, accepted: Set<string>): boolean {
  if (accepted.has(sessionId)) return true;
  const last = userMessages(eventsOf(store, sessionId)).findLast(
    ({ origin }) => origin === undefined || !TRAFFIC.has(origin.kind),
  );
  return last !== undefined && (last.origin === undefined || last.origin.kind === "answer");
}

function transcriptLine(event: SessionEvent, leadName: string): string | undefined {
  switch (event.type) {
    case "message": {
      const { role, text, origin } = event.payload;
      if (role === "assistant") return `## ${leadName}\n${text}`;
      return `## ${origin === undefined ? "The user" : `Office Town (${origin.kind})`}\n${text}`;
    }
    case "action.started":
      return `- ${event.payload.title}`;
    case "permission.requested":
      return `- Asked the user: ${event.payload.title}`;
    case "permission.resolved":
      return `- The user's answer: ${event.payload.optionId ?? event.payload.outcome}`;
    default:
      return undefined;
  }
}

export function transcriptOf(sessions: SessionEvent[][], leadName: string): string {
  return sessions
    .flat()
    .flatMap((event) => transcriptLine(event, leadName) ?? [])
    .join("\n\n");
}

function list(title: string, items: string[]): string {
  return items.length === 0 ? "" : `\n\n${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

// What the records hold, so nothing the user said or a worker returned rests on the lead's memory.
function recordsOf(context: TeamContext, taskId: string, events: SessionEvent[]): string {
  const { store } = context;
  const said = userMessages(events).flatMap(({ text, origin }) => {
    if (origin === undefined) return [`You: ${text}`];
    if (origin.kind === "answer") return [`Your answer to a question: ${text}`];
    return [];
  });
  const pieces = store.listDelegations(taskId).map((delegation) => {
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const open = delegation.status === "working";
    const brief =
      open || delegation.brief.length <= SHOWN_BRIEF
        ? delegation.brief
        : `${delegation.brief.slice(0, SHOWN_BRIEF)}…`;
    const result = delegation.result ? `\n  Result: ${delegation.result}` : "";
    return `${name}, ${open ? "still working" : delegation.status}:\n  Brief: ${brief}${result}`;
  });
  return `${list("What the user told you", said)}${list("Work handed out", pieces)}`;
}

function handoverText(handover: Handover): string {
  const files = list("Files to know", handover.files);
  return `${list("Decisions, with why", handover.decisions)}${list("What you learned", handover.facts)}\n\nWhere the goal stands and what comes next:\n${handover.next}${files}`;
}

// Starts the fresh session first, so a worker's result never wakes the old one in between.
async function carryOver(
  context: TeamContext,
  old: SessionRecord,
  handover: Handover,
): Promise<void> {
  const { store, registry, dataFolder } = context;
  const lead = store.getAgent(old.agentId);
  if (lead === undefined) return;
  const sessions = store
    .listSessions(old.taskId)
    .filter((session) => session.agentId === old.agentId)
    .map((session) => eventsOf(store, session.id));
  const events = sessions.flat();
  const brief = userMessages(events).findLast(
    ({ origin }) => origin?.kind === "brief" && origin.summary === LEAD_BRIEF_SUMMARY,
  );
  if (brief === undefined) return;
  const folder = join(dataFolder, "handovers", old.taskId);
  const file = join(folder, `${old.id}.md`);
  await mkdir(folder, { recursive: true });
  await writeFile(file, transcriptOf(sessions, lead.name));
  const { environment, workspacePath, additionalPaths = [], readOnlyPaths = [] } = old.options;
  const seen = environment === undefined ? file : environmentPath(environment, file);
  const text = `${brief.text}

You carry on from your earlier session in this goal; the user had it hand over so your conversation starts short.

What it handed over:${handoverText(handover)}

What the records say:${recordsOf(context, old.taskId, events)}

The earlier conversation is in ${seen}. If a detail you need is missing here, search that file; do not read it whole.

Say in a few lines where the goal stands, then carry on. Workers' results keep reaching you as messages.`;
  const message: Message = {
    text,
    origin: { kind: "brief", summary: "Handover from the earlier session" },
  };
  try {
    await registry.start({
      taskId: old.taskId,
      agentId: old.agentId,
      options: sessionOptionsFor(store, lead, {
        workspacePath,
        additionalPaths,
        readOnlyPaths: [...readOnlyPaths, folder],
      }),
      message,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await registry.tell(old.id, {
      text: `The fresh session could not start (${reason}). Carry on here.`,
      origin: { kind: "notice", summary: "The fresh session could not start" },
    });
    return;
  }
  await registry.stop(old.id, true);
}

export class Handovers {
  readonly #context: TeamContext;
  readonly #pending = new Map<string, Handover>();
  // Sessions whose user took the suggestion; conversations already offered one.
  readonly #accepted = new Set<string>();
  readonly #offered = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => {
      if (event.type !== "turn.ended") return;
      void this.#onTurnEnded(event.sessionId, event.payload.usage?.contextTokens).catch(
        (error: unknown) => console.error("Could not hand the lead over.", error),
      );
    });
  }

  tool() {
    const context = this.#context;
    return defineTool({
      name: "hand_over",
      description:
        "Carry on in a fresh session with a short conversation, only when the user asks for it " +
        "or accepts the app's suggestion. Write down everything the fresh session needs; it " +
        "also gets the user's messages, every piece handed out with its result, and the earlier " +
        "conversation as a file. End your turn after calling it.",
      input: z.object({
        decisions: z
          .array(z.string().min(1))
          .describe("Every decision made so far, each with why, including the user's."),
        facts: z
          .array(z.string().min(1))
          .describe(
            "What you learned that the work depends on: how things run, what failed and why.",
          ),
        next: z.string().min(1).describe("Where the goal stands and what you do next."),
        files: z
          .array(z.string().min(1))
          .optional()
          .describe("Files the fresh session should know, each with what it holds."),
      }),
      offeredTo: isLead(context),
      call: ({ decisions, facts, next, files = [] }, caller: Caller) => {
        if (teamOf(context, caller) === undefined) throw new ToolError(NOT_YET);
        if (!userAsked(context.store, caller.sessionId, this.#accepted)) {
          throw new ToolError("Hand over only when the user asks for it.");
        }
        this.#pending.set(caller.sessionId, { decisions, facts, next, files });
        return "Your handover is saved. End your turn now; a fresh session carries on from it.";
      },
    });
  }

  async #onTurnEnded(sessionId: string, contextTokens: number | undefined): Promise<void> {
    const { store } = this.#context;
    const session = store.getSession(sessionId);
    if (session === undefined) return;
    const handover = this.#pending.get(sessionId);
    if (handover !== undefined) {
      this.#pending.delete(sessionId);
      this.#accepted.delete(sessionId);
      await carryOver(this.#context, session, handover);
      return;
    }
    if (contextTokens === undefined || contextTokens < SUGGEST_AT_TOKENS) return;
    if (!leadsTeam(store, { ...session, sessionId })) return;
    const conversation = session.harnessSessionId ?? session.id;
    if (this.#offered.has(conversation)) return;
    const workOut = store
      .listDelegations(session.taskId)
      .some((delegation) => delegation.status === "working");
    if (!workOut) return;
    this.#offered.add(conversation);
    this.#suggest(session, contextTokens);
  }

  #suggest(session: SessionRecord, contextTokens: number): void {
    const { store, registry } = this.#context;
    const name = store.getAgent(session.agentId)?.name ?? "The lead";
    const requestId = `handover-${randomUUID()}`;
    registry.ask(
      session.id,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title: `${name}'s conversation is ${Math.round(contextTokens / 1000)}k tokens long, and each of its steps reads all of it. Carry on in a fresh session with a handover?`,
          input: { contextTokens },
          options: [
            { optionId: "approve", label: "Start a fresh session", kind: "allow_once" },
            { optionId: "decline", label: "Keep this session", kind: "reject_once" },
          ],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
        const approved = command.optionId === "approve";
        return {
          resolution: {
            type: "permission.resolved",
            payload: {
              requestId,
              outcome: approved ? "allowed" : "denied",
              optionId: command.optionId,
              answeredBy: "user",
            },
          },
          afterwards: async () => {
            if (!approved) return;
            this.#accepted.add(session.id);
            await registry.tell(session.id, {
              text: "The user wants you to carry on in a fresh session. Call hand_over now with everything it needs, then end your turn.",
              origin: { kind: "notice", summary: "You chose a fresh session" },
            });
          },
        };
      },
    );
  }
}
