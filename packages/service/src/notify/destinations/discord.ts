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

// A message holds 2,000 characters; a longer result goes as its file (20 MiB by default).
const CONTENT_CHARS = 2_000;
// No @everyone, @here or role pings from an agent's words.
const NO_PINGS = { parse: [] };

function bodyOf(message: Outgoing): string | FormData {
  const text = fullText(message);
  if (text.length <= CONTENT_CHARS) {
    return JSON.stringify({ content: text, allowed_mentions: NO_PINGS });
  }
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ content: cut(text, 300), allowed_mentions: NO_PINGS }));
  form.set("files[0]", resultFile(message), "result.md");
  return form;
}

async function send(message: Outgoing, place: Place<"discord">) {
  const url = place.keys.url;
  if (url === undefined) throw new SendError("it has no webhook address", false);
  const body = bodyOf(message);
  const response = await post(url, {
    method: "POST",
    body,
    ...(typeof body === "string" ? { headers: { "content-type": "application/json" } } : {}),
  });
  if (response.ok) return;
  const reply = (await response.json().catch(() => ({}))) as { retry_after?: number };
  const gone = response.status === 401 || response.status === 403 || response.status === 404;
  throw refused(
    response,
    gone ? "the webhook address was refused or deleted" : `Discord answered ${response.status}`,
    reply.retry_after,
  );
}

export const discord: Destination<"discord"> = {
  kind: "discord",
  service: "Discord",
  keys: ["url"],
  gapMs: 600,
  send,
};
