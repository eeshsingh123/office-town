import {
  cut,
  type Destination,
  fullText,
  type Outgoing,
  type Place,
  post,
  refused,
  resultFile,
  SendError,
} from "./destination.ts";

export const TELEGRAM_API = "https://api.telegram.org";
// Telegram's own limits (Bot API, checked 2026-11-24): a message holds 4,096 characters, a file's
// caption 1,024, and a bot sends files up to 50 MB.
const TEXT_CHARS = 4_096;
const CAPTION_CHARS = 1_024;

interface TelegramReply {
  ok: boolean;
  result?: unknown;
  description?: string;
  parameters?: { retry_after?: number };
}

// What Telegram's refusal means, in plain words.
function reasonOf(status: number, description: string | undefined): string {
  if (status === 401 || status === 404) return "the bot key was refused";
  if (status === 403) return "the bot was blocked or removed from the chat";
  if (description?.includes("chat not found") === true) return "the linked chat wasn't found";
  return description === undefined
    ? `Telegram answered ${status}`
    : `Telegram said "${description}"`;
}

export async function callTelegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown> | FormData,
  base = TELEGRAM_API,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await post(`${base}/bot${token}/${method}`, {
    method: "POST",
    ...(form ? { body } : { body: JSON.stringify(body) }),
    ...(form ? {} : { headers: { "content-type": "application/json" } }),
  });
  const reply = (await response.json().catch(() => ({ ok: false }))) as TelegramReply;
  if (!response.ok || !reply.ok) {
    throw refused(
      response,
      reasonOf(response.status, reply.description),
      reply.parameters?.retry_after,
    );
  }
  return reply.result as T;
}

// Plain text, never Markdown or HTML, so an agent's words can't hide a link or break the message.
// One way: the chat is the one linked with a code, and nothing sent there is read back (D-132).
async function send(message: Outgoing, place: Place<"telegram">) {
  const token = place.keys.token;
  const chatId = place.link?.chatId;
  if (token === undefined) throw new SendError("it has no bot key", false);
  if (chatId === undefined) {
    throw new SendError("link your chat first: send the bot the code from Connectors", false);
  }
  const text = fullText(message);
  if (text.length <= TEXT_CHARS) {
    await callTelegram(token, "sendMessage", { chat_id: chatId, text }, place.base);
  } else {
    await sendAsFile(token, chatId, message, place.base);
  }
}

// A long result goes as its file, with its start as the caption.
function sendAsFile(token: string, chatId: number, message: Outgoing, base?: string) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", cut(fullText(message), CAPTION_CHARS));
  form.set("document", resultFile(message), "result.md");
  return callTelegram(token, "sendDocument", form, base);
}

export const telegram: Destination<"telegram"> = {
  kind: "telegram",
  service: "Telegram",
  keys: ["token"],
  // Telegram asks for at most one message a second in one chat.
  gapMs: 1_100,
  send,
};
