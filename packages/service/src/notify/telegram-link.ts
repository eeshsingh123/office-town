import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { DestinationRecord, TelegramCode } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import { SendError } from "./destinations/destination.ts";
import { callTelegram, TELEGRAM_API } from "./destinations/telegram.ts";
import type { Outbox } from "./outbox.ts";

// Telegram holds a long poll this long when nothing comes (Bot API: `timeout`, in seconds).
const POLL_SECONDS = 30;
const CODE_MS = 10 * 60_000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RETRY_MS = 5_000;
const REFUSED_KEY = "The bot key was refused.";

interface TelegramMessage {
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
}

interface Update {
  update_id: number;
  message?: TelegramMessage;
}

interface Waiting {
  code: string;
  expiresAt: number;
  stop: AbortController;
}

// A bot can't message anyone who hasn't messaged it first, so the user sends it a one-time code,
// which names their chat. The core reads Telegram only while a code waits, at most 10 minutes, and
// never again once linked: Telegram is one way, like every destination (D-132).
export class TelegramLink {
  readonly #store: Store;
  readonly #outbox: Outbox;
  readonly #base: string;
  readonly #waiting = new Map<string, Waiting>();

  constructor(store: Store, outbox: Outbox, base = TELEGRAM_API) {
    this.#store = store;
    this.#outbox = outbox;
    this.#base = base;
  }

  stop(): void {
    for (const id of [...this.#waiting.keys()]) this.forget(id);
  }

  // A code waiting for a removed destination, or one whose key changed, stops waiting.
  forget(destinationId: string): void {
    this.#waiting.get(destinationId)?.stop.abort();
    this.#waiting.delete(destinationId);
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
    this.forget(destination.id);
    const waiting: Waiting = { code, expiresAt, stop: new AbortController() };
    this.#waiting.set(destination.id, waiting);
    void this.#listen(destination.id, token, waiting).finally(() => {
      if (this.#waiting.get(destination.id) === waiting) this.#waiting.delete(destination.id);
    });
    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      ...(bot.username === undefined ? {} : { url: `https://t.me/${bot.username}?start=${code}` }),
    };
  }

  async #listen(destinationId: string, token: string, waiting: Waiting): Promise<void> {
    const signal = waiting.stop.signal;
    let offset: number | undefined;
    while (!signal.aborted && Date.now() < waiting.expiresAt) {
      try {
        const left = Math.ceil((waiting.expiresAt - Date.now()) / 1000);
        const updates = await this.#updates(token, offset, Math.min(POLL_SECONDS, left), signal);
        for (const update of updates) {
          offset = update.update_id + 1;
          if (await this.#linked(destinationId, token, waiting.code, update.message)) return;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof SendError && !error.retry) {
          this.#store.destinations.setProblem(destinationId, REFUSED_KEY);
          return;
        }
        await delay(RETRY_MS, undefined, { ref: false, signal }).catch(() => undefined);
      }
    }
  }

  async #updates(
    token: string,
    offset: number | undefined,
    seconds: number,
    signal: AbortSignal,
  ): Promise<Update[]> {
    const response = await fetch(`${this.#base}/bot${token}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timeout: seconds,
        allowed_updates: ["message"],
        ...(offset === undefined ? {} : { offset }),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout((seconds + 15) * 1000)]),
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

  // Only a private message with the code links; anything else sent to the bot is ignored.
  async #linked(
    destinationId: string,
    token: string,
    code: string,
    message: TelegramMessage | undefined,
  ): Promise<boolean> {
    if (message?.chat.type !== "private" || message.from === undefined) return false;
    const sent = (message.text ?? "")
      .trim()
      .replace(/^\/start\s*/, "")
      .toUpperCase();
    if (sent !== code) return false;
    const { from } = message;
    const { destinations } = this.#store;
    destinations.setLink(destinationId, {
      chatId: message.chat.id,
      userId: from.id,
      name: from.username === undefined ? (from.first_name ?? "Telegram") : `@${from.username}`,
      linkedAt: new Date().toISOString(),
    });
    destinations.setProblem(destinationId, undefined);
    await callTelegram(
      token,
      "sendMessage",
      {
        chat_id: message.chat.id,
        text: "Linked. Results and alerts from your automations will arrive here. Answer them in Office Town.",
      },
      this.#base,
    ).catch(() => undefined);
    return true;
  }
}
