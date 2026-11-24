import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentCommand, DestinationRecord, TelegramCode } from "@office-town/contract";
import type { OutboxRow } from "../store/destinations-store.ts";
import { isOpen, latestSession } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { topSession } from "../team/task-state.ts";
import { continueTeam, resumeInTask } from "../team/team-tasks.ts";
import type { AskAnswers } from "./asks.ts";
import { SendError } from "./destinations/destination.ts";
import { callTelegram, TELEGRAM_API } from "./destinations/telegram.ts";
import { type Outbox, parse } from "./outbox.ts";

// Telegram holds a long poll this long when nothing comes (Bot API: `timeout`, in seconds).
const POLL_SECONDS = 30;
const CODE_MS = 10 * 60_000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// After a failed poll: soon for a network blip, slowly for a refused key.
const RETRY_MS = { network: 30_000, refused: 5 * 60_000 };
const REFUSED_KEY = "The bot key was refused.";
const NOT_ANSWERED = "Reply to one of my messages to answer it, or to give that run its next step.";

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  reply_to_message?: { message_id: number };
}

interface Update {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
}

interface Polling {
  stop: AbortController;
  token: string;
}

// Telegram, once linked to one chat and one person, answers asks and gives runs their next step
// (D-132). The core only ever reaches out, by long polling, so nothing on the computer is open to
// the internet. Each update's place is stored before it is acted on, so none acts twice.
export class TelegramReplies {
  readonly #context: TeamContext;
  readonly #outbox: Outbox;
  readonly #base: string;
  readonly #polls = new Map<string, Polling>();
  readonly #codes = new Map<string, { code: string; expiresAt: number }>();

  constructor(context: TeamContext, outbox: Outbox, base = TELEGRAM_API) {
    this.#context = context;
    this.#outbox = outbox;
    this.#base = base;
  }

  start(): void {
    for (const destination of this.#context.store.destinations.list()) this.follow(destination);
    this.#context.store.subscribe((change) => {
      if (change.type === "destination") this.follow(change.destination);
      if (change.type === "destination.removed") this.#stop(change.destinationId);
    });
  }

  stop(): void {
    for (const id of [...this.#polls.keys()]) this.#stop(id);
  }

  // Polls while it has a bot key; a new key starts again.
  follow(destination: DestinationRecord): void {
    if (destination.settings.kind !== "telegram") return;
    const token = this.#outbox.keysOf(destination.id).token;
    const polling = this.#polls.get(destination.id);
    if (polling?.token === token) return;
    this.#stop(destination.id);
    if (token === undefined) return;
    const stop = new AbortController();
    this.#polls.set(destination.id, { stop, token });
    void this.#poll(destination.id, token, stop.signal);
  }

  // The code to send the bot: the next private message carrying it links that chat and person.
  async linkCode(destination: DestinationRecord): Promise<TelegramCode> {
    const token = this.#outbox.keysOf(destination.id).token;
    if (token === undefined) throw new SendError("it has no bot key", false);
    const bot = await callTelegram<{ username?: string }>(token, "getMe", {}, this.#base);
    const code = Array.from({ length: 8 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join(
      "",
    );
    const expiresAt = Date.now() + CODE_MS;
    this.#codes.set(destination.id, { code, expiresAt });
    this.follow(destination);
    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      ...(bot.username === undefined ? {} : { url: `https://t.me/${bot.username}?start=${code}` }),
    };
  }

  #stop(destinationId: string): void {
    this.#polls.get(destinationId)?.stop.abort();
    this.#polls.delete(destinationId);
  }

  async #poll(destinationId: string, token: string, signal: AbortSignal): Promise<void> {
    const { destinations } = this.#context.store;
    while (!signal.aborted) {
      try {
        const updates = await this.#updates(token, destinations.nextUpdate(destinationId), signal);
        if (destinations.get(destinationId)?.problem === REFUSED_KEY) {
          destinations.setProblem(destinationId, undefined);
        }
        for (const update of updates) {
          destinations.setNextUpdate(destinationId, update.update_id + 1);
          await this.#handle(destinationId, token, update).catch((error: unknown) => {
            console.error("Could not act on a Telegram reply.", error);
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        const refused = error instanceof SendError && !error.retry;
        if (refused) destinations.setProblem(destinationId, REFUSED_KEY);
        await delay(refused ? RETRY_MS.refused : RETRY_MS.network, undefined, {
          ref: false,
          signal,
        }).catch(() => undefined);
      }
    }
  }

  async #updates(
    token: string,
    offset: number | undefined,
    signal: AbortSignal,
  ): Promise<Update[]> {
    const response = await fetch(`${this.#base}/bot${token}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timeout: POLL_SECONDS,
        allowed_updates: ["message", "callback_query"],
        ...(offset === undefined ? {} : { offset }),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout((POLL_SECONDS + 15) * 1000)]),
    });
    const reply = (await response.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      result?: Update[];
    };
    if (response.status === 401 || response.status === 404) {
      throw new SendError(REFUSED_KEY, false);
    }
    if (!reply.ok) throw new SendError("Telegram didn't answer", true);
    return reply.result ?? [];
  }

  async #handle(destinationId: string, token: string, update: Update): Promise<void> {
    const destination = this.#context.store.destinations.get(destinationId);
    if (destination === undefined) return;
    if (update.message !== undefined) await this.#message(destination, token, update.message);
    if (update.callback_query !== undefined)
      await this.#tapped(destination, token, update.callback_query);
  }

  async #message(destination: DestinationRecord, token: string, message: TelegramMessage) {
    const text = message.text?.trim() ?? "";
    if (await this.#linking(destination, token, message, text)) return;
    // Anyone else who finds the bot is ignored.
    if (!this.#fromLinked(destination, message.chat.id, message.from?.id)) return;
    const replyTo = message.reply_to_message?.message_id;
    const row =
      replyTo === undefined
        ? undefined
        : this.#context.store.destinations.bySentId(destination.id, String(replyTo));
    const said = row === undefined || text === "" ? NOT_ANSWERED : await this.#replied(row, text);
    await this.#say(token, message.chat.id, said, message.message_id);
  }

  async #linking(
    destination: DestinationRecord,
    token: string,
    message: TelegramMessage,
    text: string,
  ): Promise<boolean> {
    const pending = this.#codes.get(destination.id);
    if (pending === undefined || message.chat.type !== "private" || message.from === undefined) {
      return false;
    }
    const sent = text.replace(/^\/start\s*/, "").toUpperCase();
    if (sent !== pending.code || Date.now() > pending.expiresAt) return false;
    this.#codes.delete(destination.id);
    const { from } = message;
    this.#context.store.destinations.setLink(destination.id, {
      chatId: message.chat.id,
      userId: from.id,
      name: from.username === undefined ? (from.first_name ?? "Telegram") : `@${from.username}`,
      linkedAt: new Date().toISOString(),
    });
    await this.#say(
      token,
      message.chat.id,
      "Linked. Results and asks from your automations will arrive here.",
    );
    return true;
  }

  #fromLinked(
    destination: DestinationRecord,
    chatId: number | undefined,
    userId: number | undefined,
  ) {
    const { link } = destination;
    return link !== undefined && link.chatId === chatId && link.userId === userId;
  }

  // A reply to an ask answers it; a reply to a result is that run's next step.
  async #replied(row: OutboxRow, text: string): Promise<string> {
    const queued = parse(row);
    if (queued.kind === "ask") {
      const { ask } = queued;
      if (ask?.reply === undefined) return "Answer this on your computer.";
      return this.#answer(ask, this.#textAnswer(ask, text), `Answered: ${text}`, text);
    }
    if (queued.kind !== "result" || row.runId === null) return NOT_ANSWERED;
    return this.#carryOn(row.runId, text);
  }

  #textAnswer(ask: AskAnswers, text: string): AgentCommand {
    const { requestId, reply } = ask;
    if (reply?.kind === "question") {
      return {
        type: "answerQuestion",
        requestId,
        answers: [{ questionId: reply.questionId, selected: [text] }],
      };
    }
    if (reply?.kind === "deny")
      return { type: "answerPermission", requestId, optionId: reply.optionId };
    return { type: "answerPlan", requestId, answer: { outcome: "revised", note: text } };
  }

  async #tapped(
    destination: DestinationRecord,
    token: string,
    tap: NonNullable<Update["callback_query"]>,
  ): Promise<void> {
    if (!this.#fromLinked(destination, tap.message?.chat.id, tap.from.id)) {
      await callTelegram(token, "answerCallbackQuery", { callback_query_id: tap.id }, this.#base);
      return;
    }
    const [ref, choiceId] = (tap.data ?? "").split(":");
    const row =
      ref === undefined ? undefined : this.#context.store.destinations.sentRow(Number(ref));
    const queued = row?.destinationId === destination.id ? parse(row) : undefined;
    const choice = queued?.ask?.choices?.find((one) => one.id === choiceId);
    const said =
      queued?.ask === undefined || choice === undefined
        ? "This button no longer works."
        : await this.#answer(queued.ask, choice.answer, choice.done);
    await callTelegram(
      token,
      "answerCallbackQuery",
      { callback_query_id: tap.id, text: said.slice(0, 200) },
      this.#base,
    );
    if (tap.message !== undefined) {
      await callTelegram(
        token,
        "editMessageReplyMarkup",
        { chat_id: tap.message.chat.id, message_id: tap.message.message_id },
        this.#base,
      ).catch(() => undefined);
      await this.#say(token, tap.message.chat.id, said, tap.message.message_id);
    }
  }

  // Only while the ask still waits: one answered at the computer, or gone with its agent, is not.
  async #answer(
    ask: AskAnswers,
    command: AgentCommand,
    done: string,
    reason?: string,
  ): Promise<string> {
    const { store, registry } = this.#context;
    const waiting = store
      .listPendingRequests()
      .requests.some(
        ({ event }) =>
          event.sessionId === ask.sessionId && event.payload.requestId === ask.requestId,
      );
    if (!waiting) {
      return registry.isRunning(ask.sessionId)
        ? "Already answered on your computer."
        : "This ask is gone: the agent stopped.";
    }
    await registry.send(ask.sessionId, command, "telegram");
    // A no with a reason: the agent hears why.
    if (ask.reply?.kind === "deny" && command.type === "answerPermission" && reason !== undefined) {
      await registry.tell(ask.sessionId, {
        text: `The user said no, from Telegram: ${reason}`,
        origin: { kind: "telegram" },
      });
      return `Denied: ${reason}`;
    }
    return done;
  }

  // A run at work hears it as a message; a finished one carries on, as Continue would. Anything
  // risky it then tries still waits at the computer (D-132).
  async #carryOn(runId: string, text: string): Promise<string> {
    const context = this.#context;
    const { store, registry } = context;
    const taskId = store.automations.getRun(runId)?.taskId;
    const task = taskId === undefined ? undefined : store.getTask(taskId);
    if (task === undefined) return "That run's task was deleted.";
    const top = topSession(task, store.listSessions(task.id));
    const agentId = task.leadAgentId ?? top?.agentId;
    const latest = agentId === undefined ? undefined : latestSession(context, task.id, agentId);
    if (latest === undefined) return "That run never started.";
    const message = { text, origin: { kind: "telegram" as const } };
    if (isOpen(latest)) {
      await registry.tell(latest.id, message);
      return "Sent to the run.";
    }
    if (task.leadAgentId !== undefined) await continueTeam(context, task.id, text);
    else await resumeInTask(context, latest, message);
    return "Sent. It carries on with this now.";
  }

  async #say(token: string, chatId: number, text: string, replyTo?: number): Promise<void> {
    await callTelegram(
      token,
      "sendMessage",
      {
        chat_id: chatId,
        text,
        ...(replyTo === undefined ? {} : { reply_parameters: { message_id: replyTo } }),
      },
      this.#base,
    );
  }
}
