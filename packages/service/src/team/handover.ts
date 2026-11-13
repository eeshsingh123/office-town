import { randomUUID } from "node:crypto";
import type { PlanStep, SessionEvent, SessionRecord, TaskRecord } from "@office-town/contract";
import { z } from "zod";
import { isChiefTask } from "../chief/chief.ts";
import { handoverProgress, milestonesOn } from "../goal/record.ts";
import type { SessionActivity } from "../registry/activity.ts";
import { AnswerError, type Message, SessionNotRunningError } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { carryOver, type Handover, type HandoverRole, userAsked } from "./carry-over.ts";
import { leadsTeam } from "./lead.ts";
import type { TeamContext } from "./members.ts";

// One place: the lead's suggestion, past this, with work still out (owner, D-94).
export const SUGGEST_AT_TOKENS = 300_000;
// Efficient: past this, or earlier than the AI app's own compaction, whichever comes first.
export const HAND_OVER_AT_TOKENS = 350_000;
// OpenCode compacts at 85% of the window by default and Claude Code near all of it.
const WINDOW_SHARE = 0.8;
// An agent that let a request pass is asked once more after this much growth, then left alone.
const ASK_AGAIN_AFTER_TOKENS = 50_000;
const MAX_ASKS = 2;
// A session that began from a handover is asked only after this much work of its own.
const NEW_WORK_TOKENS = 50_000;

export interface HandoverOptions {
  // Test runs only, to keep a live run short; not a product setting.
  handOverAt?: number;
}

const windowKey = ({ options }: SessionRecord) => `${options.harness}:${options.model ?? ""}`;

// A chief's goal takes its departments' pieces along, so the whole goal runs one way (D-94).
export function setEfficient(store: Store, taskId: string, efficient: boolean): TaskRecord {
  for (const { pieceTaskId } of store.listPieces(taskId)) {
    if (pieceTaskId !== undefined) store.setTaskEfficient(pieceTaskId, efficient);
  }
  return store.setTaskEfficient(taskId, efficient);
}

export function roleOf(store: Store, { taskId, agentId }: Caller): HandoverRole | undefined {
  // A checker is a guest with no conversation worth carrying (D-73).
  if (store.getAgent(agentId)?.guest === true) return undefined;
  const task = store.getTask(taskId);
  if (task === undefined) return undefined;
  if (task.leadAgentId === agentId) return isChiefTask(store, taskId) ? "chief" : "lead";
  return task.leadAgentId === undefined ? "solo" : "worker";
}

// Results will wake it, and each of its next turns reads the whole conversation again.
function workOut(store: Store, role: HandoverRole, taskId: string): boolean {
  if (role === "lead") {
    return store.listDelegations(taskId).some((delegation) => delegation.status === "working");
  }
  if (role === "chief") {
    return store
      .listPieces(taskId)
      .some((piece) => ["waiting", "queued", "working"].includes(piece.status));
  }
  return false;
}

const NOTE_FOR: Record<HandoverRole, string> = {
  worker: "what of your piece is done and what is left",
  lead: "where the goal stands",
  chief: "where each part of your plan stands",
  solo: "where the task stands",
};

function askToWrite(role: HandoverRole, contextTokens: number): Message {
  return {
    text: `Your conversation is ${Math.round(contextTokens / 1000)}k tokens long, and each of your steps reads all of it again. Finish the step you are on, then call hand_over with everything a new session needs to carry on, including ${NOTE_FOR[role]}, and end your turn. Your folders and files stay as they are.`,
    origin: { kind: "notice", summary: "Asked to carry on in a new session" },
  };
}

interface Watch {
  asks: number;
  askedAt: number;
  // The size a session that began from a handover started at.
  startedAt?: number;
}

const STEP_WORDS: Record<PlanStep["status"], string> = {
  completed: "done",
  in_progress: "doing",
  pending: "next",
};

const stepLines = (plan: readonly PlanStep[]) =>
  plan.map((step) => `${STEP_WORDS[step.status]}: ${step.title}`);

export class Handovers {
  readonly #context: TeamContext;
  readonly #handOverAt: number;
  // Written, waiting for the turn to end.
  readonly #pending = new Map<string, { handover: Handover; role: HandoverRole }>();
  // Sessions that may hand over: the app asked (Efficient), or the user agreed.
  readonly #cleared = new Set<string>();
  // Sessions with an approval in Needs you; conversations already offered One place's suggestion.
  readonly #asking = new Set<string>();
  readonly #offered = new Set<string>();
  readonly #watches = new Map<string, Watch>();
  readonly #carried = new Set<string>();
  // Conversations whose new session failed to start: not asked again while the core runs.
  readonly #failed = new Set<string>();
  readonly #activity: SessionActivity;
  readonly #turnOpen = new Set<string>();
  // Each session's step list as it last reported it, for a handover from the record (D-95).
  readonly #plans = new Map<string, PlanStep[]>();
  // Carrying over now: a turn's end and a sub-agent's end may both try at once.
  readonly #switching = new Set<string>();
  // Each model's window as last reported, by harness and model, for a session that has not yet.
  readonly #windows = new Map<string, number>();

  constructor(
    context: TeamContext,
    activity: SessionActivity,
    { handOverAt = HAND_OVER_AT_TOKENS }: HandoverOptions = {},
  ) {
    this.#context = context;
    this.#activity = activity;
    this.#handOverAt = handOverAt;
    context.registry.subscribe(({ event }) => {
      this.#follow(event).catch((error: unknown) =>
        console.error("Could not carry an agent on in a new session.", error),
      );
    });
  }

  tool() {
    const { store } = this.#context;
    return defineTool({
      name: "hand_over",
      description:
        "Carry on in a new session when the user or the app asks you to. Write down " +
        "everything the new session needs; it also gets your brief, what the user said, the " +
        "work handed out with its results, and your earlier conversation as a file. End your " +
        "turn after calling it.",
      input: z.object({
        decisions: z
          .array(z.string().min(1))
          .describe("Every decision made so far, each with why, including the user's."),
        facts: z
          .array(z.string().min(1))
          .describe(
            "What you learned that the work depends on: how things run, what failed and why.",
          ),
        next: z
          .string()
          .min(1)
          .describe(
            "Where the work stands and what you do next, with any program you left running that the work needs: it stops with this session.",
          ),
        progress: z
          .string()
          .min(1)
          .optional()
          .describe(
            "A worker: what of your piece is done and what is left. The chief: where each part of your plan stands.",
          ),
        steps: z
          .array(z.string().min(1))
          .optional()
          .describe("Your todo list as it stands, in order, each step marked done, doing or next."),
        files: z
          .array(z.string().min(1))
          .optional()
          .describe("Files the new session should know, each with what it holds."),
      }),
      offeredTo: (caller) => roleOf(store, caller) !== undefined,
      call: (input, caller) => {
        const role = roleOf(store, caller);
        const session = store.getSession(caller.sessionId);
        if (role === undefined || session === undefined) throw new ToolError("Not available.");
        const cleared = this.#cleared.has(session.id) || userAsked(store, session);
        if (!cleared) {
          this.#askUser(session, `${this.#nameOf(session)} asks to carry on in a new session`);
          return "The user decides in Needs you. Carry on with your work meanwhile; if they agree, you will be asked to write it again.";
        }
        const { files = [], steps: written = [], progress: told, ...rest } = input;
        // With Milestones on, where the work stands comes from the record, not the agent (D-95).
        const progress = handoverProgress(store, caller) ?? told;
        const kept = milestonesOn(store, caller.taskId) ? this.#plans.get(session.id) : undefined;
        const steps = kept === undefined ? written : stepLines(kept);
        const handover = { ...rest, files, steps, ...(progress === undefined ? {} : { progress }) };
        this.#pending.set(session.id, { handover, role });
        this.#context.registry.hold(session.id);
        return "Your handover is saved. End your turn now; a new session carries on from it.";
      },
    });
  }

  async #follow(event: SessionEvent): Promise<void> {
    const { sessionId } = event;
    switch (event.type) {
      case "action.ended":
        // A handover that waited for its last sub-agent after the turn ended goes ahead now.
        if (!this.#turnOpen.has(sessionId)) await this.#carryOver(sessionId);
        return;
      case "context.measured":
        await this.#check(
          sessionId,
          event.payload.contextTokens,
          event.payload.contextWindow,
          false,
        );
        return;
      case "turn.started":
        this.#turnOpen.add(sessionId);
        return;
      case "plan.updated":
        this.#plans.set(sessionId, event.payload.steps);
        return;
      case "turn.ended": {
        this.#turnOpen.delete(sessionId);
        if (this.#pending.has(sessionId)) {
          await this.#carryOver(sessionId);
          return;
        }
        const tokens = event.payload.usage?.contextTokens;
        if (tokens !== undefined) await this.#check(sessionId, tokens, undefined, true);
        return;
      }
      case "session.ended":
        this.#plans.delete(sessionId);
        await this.#forget(sessionId);
        return;
      default:
        return;
    }
  }

  // A sub-agent's process dies with its session's (D-71), so none hands over while one runs.
  #subAgentsRun(sessionId: string): boolean {
    return (this.#activity.of(sessionId)?.subAgents.size ?? 0) > 0;
  }

  async #check(
    sessionId: string,
    tokens: number,
    reported: number | undefined,
    turnEnded: boolean,
  ): Promise<void> {
    const { store } = this.#context;
    const session = store.getSession(sessionId);
    const task = session === undefined ? undefined : store.getTask(session.taskId);
    if (session === undefined || task === undefined || task.paused !== undefined) return;
    if (reported !== undefined) this.#windows.set(windowKey(session), reported);
    const window =
      task.efficient === true ? (reported ?? (await this.#knownWindow(session))) : undefined;
    if (this.#pending.has(sessionId) || this.#asking.has(sessionId)) return;
    if (task.efficient === true) this.#askToHandOver(session, tokens, window, turnEnded);
    else if (turnEnded) this.#suggest(session, tokens);
  }

  // Until a session reports its window: what the same model reported, else the AI app's list.
  async #knownWindow(session: SessionRecord): Promise<number | undefined> {
    const known = this.#windows.get(windowKey(session));
    if (known !== undefined) return known;
    const { harness, environment, model = "default" } = session.options;
    // Without the list, the trigger stays at HAND_OVER_AT_TOKENS.
    const catalog = await this.#context.readCatalog(harness, environment).catch(() => undefined);
    return catalog?.models.find((one) => one.id === model || one.resolvedId === model)
      ?.contextWindow;
  }

  // Efficient: the app asks at the next tool end; choosing the mode was the approval (owner).
  // At a turn's end only an agent with work still out, or a finished one would be woken for
  // nothing; the others are asked during their next turn.
  #askToHandOver(
    session: SessionRecord,
    tokens: number,
    window: number | undefined,
    turnEnded: boolean,
  ): void {
    const { store, registry } = this.#context;
    const role = roleOf(store, { ...session, sessionId: session.id });
    if (role === undefined || this.#subAgentsRun(session.id)) return;
    if (turnEnded && !workOut(store, role, session.taskId)) return;
    if (this.#failed.has(session.harnessSessionId ?? session.id)) return;
    const watch = this.#watches.get(session.id) ?? {
      asks: 0,
      askedAt: 0,
      ...(this.#carried.has(session.id) ? { startedAt: tokens } : {}),
    };
    this.#watches.set(session.id, watch);
    const limit = Math.min(
      this.#handOverAt,
      window === undefined ? Number.POSITIVE_INFINITY : window * WINDOW_SHARE,
    );
    if (tokens < limit) return;
    if (watch.startedAt !== undefined && tokens < watch.startedAt + NEW_WORK_TOKENS) return;
    if (watch.asks > 0 && tokens < watch.askedAt + ASK_AGAIN_AFTER_TOKENS) return;
    if (watch.asks >= MAX_ASKS) {
      if (watch.asks === MAX_ASKS) {
        console.warn(`Session ${session.id} let two handover requests pass; it carries on as is.`);
      }
      watch.asks += 1;
      return;
    }
    watch.asks += 1;
    watch.askedAt = tokens;
    this.#cleared.add(session.id);
    registry.tell(session.id, askToWrite(role, tokens)).catch((error: unknown) => {
      // It ended in between; a resumed conversation is checked again.
      if (error instanceof SessionNotRunningError) return;
      console.error(`Could not ask ${session.id} to hand over.`, error);
    });
  }

  // One place: unchanged but for the size. Leads only, work still out, once per conversation.
  #suggest(session: SessionRecord, tokens: number): void {
    const { store } = this.#context;
    if (tokens < SUGGEST_AT_TOKENS) return;
    if (!leadsTeam(store, { ...session, sessionId: session.id })) return;
    const conversation = session.harnessSessionId ?? session.id;
    if (this.#offered.has(conversation)) return;
    if (!workOut(store, "lead", session.taskId)) return;
    this.#offered.add(conversation);
    this.#askUser(
      session,
      `${this.#nameOf(session)}'s conversation is ${Math.round(tokens / 1000)}k tokens long, and each of its steps reads all of it. Carry on in a new session with a complete handover?`,
    );
  }

  #nameOf(session: SessionRecord): string {
    return this.#context.store.getAgent(session.agentId)?.name ?? "The agent";
  }

  // Needs you: One place's suggestion, or an agent's own ask. Deny keeps the session.
  #askUser(session: SessionRecord, title: string): void {
    if (this.#asking.has(session.id)) return;
    const { registry } = this.#context;
    const requestId = `handover-${randomUUID()}`;
    this.#asking.add(session.id);
    registry.ask(
      session.id,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title,
          input: {},
          options: [
            { optionId: "approve", label: "Start a new session", kind: "allow_once" },
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
            this.#asking.delete(session.id);
            if (approved) this.#cleared.add(session.id);
            await registry.tell(
              session.id,
              approved
                ? {
                    text: "The user wants you to carry on in a new session. Call hand_over now with everything it needs, then end your turn.",
                    origin: { kind: "notice", summary: "You chose a new session" },
                  }
                : {
                    text: "The user wants you to keep this session. Carry on here.",
                    origin: { kind: "notice", summary: "You kept this session" },
                  },
            );
          },
        };
      },
    );
  }

  // Waits while a sub-agent runs; its end, or the next turn's end, tries again.
  async #carryOver(sessionId: string): Promise<void> {
    const { store, registry } = this.#context;
    const pending = this.#pending.get(sessionId);
    const session = store.getSession(sessionId);
    if (pending === undefined || session === undefined) return;
    if (this.#subAgentsRun(sessionId) || this.#switching.has(sessionId)) return;
    this.#switching.add(sessionId);
    try {
      const next = await carryOver(this.#context, session, pending.role, pending.handover);
      // Kept until now, so the old turn's end is never taken as the worker's result.
      this.#pending.delete(sessionId);
      this.#cleared.delete(sessionId);
      if (next === undefined) {
        this.#failed.add(session.harnessSessionId ?? session.id);
        await registry.release(sessionId);
        return;
      }
      this.#carried.add(next.id);
      await registry.release(sessionId, next.id);
      // Like an idle stop, so its end reads as finished and nothing retries it (D-44, D-77).
      await registry.stop(sessionId, true);
    } finally {
      this.#switching.delete(sessionId);
    }
  }

  // The user's own action stands for their go-ahead, such as giving an app that reaches the agent
  // only in a new conversation (D-96).
  allow(sessionId: string): void {
    this.#cleared.add(sessionId);
  }

  // Its turn's end is not a result: the piece goes on in a new session.
  isHandingOver(sessionId: string): boolean {
    return this.#pending.has(sessionId);
  }

  async #forget(sessionId: string): Promise<void> {
    const pending = this.#pending.delete(sessionId);
    this.#cleared.delete(sessionId);
    this.#asking.delete(sessionId);
    this.#watches.delete(sessionId);
    this.#carried.delete(sessionId);
    this.#turnOpen.delete(sessionId);
    // Cut off before its turn ended, as by a crash: what waited for it cannot reach it.
    if (pending) {
      await this.#context.registry.release(sessionId).catch((error: unknown) => {
        console.error(`Messages held for ${sessionId} could not be delivered.`, error);
      });
    }
  }
}
