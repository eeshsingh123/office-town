import {
  type Destination,
  fullText,
  type Outgoing,
  type Place,
  post,
  refused,
  SendError,
  split,
} from "./destination.ts";

// Slack suggests at most 4,000 characters a message; a long result goes in a few, then is cut,
// as a webhook can't send files (that needs a bot token).
const MESSAGE_CHARS = 3_900;
const MOST_MESSAGES = 5;

// Slack reads these three as markup, so an agent's words can't ping a channel or hide a link.
const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const REASONS: Record<string, string> = {
  invalid_token: "the webhook address was refused",
  no_service: "the webhook was turned off or removed",
  channel_is_archived: "its channel was archived",
  channel_not_found: "its channel wasn't found",
};

async function send(message: Outgoing, place: Place<"slack">) {
  const url = place.keys.url;
  if (url === undefined) throw new SendError("it has no webhook address", false);
  for (const text of split(fullText(message), MESSAGE_CHARS, MOST_MESSAGES)) {
    const response = await post(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: escaped(text) }),
    });
    if (response.ok) continue;
    const said = (await response.text().catch(() => "")).trim();
    throw refused(response, REASONS[said] ?? `Slack answered ${response.status}`);
  }
  return {};
}

export const slack: Destination<"slack"> = {
  kind: "slack",
  service: "Slack",
  keys: ["url"],
  // A webhook takes one message a second.
  gapMs: 1_100,
  send,
};
