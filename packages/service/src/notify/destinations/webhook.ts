import {
  type Destination,
  type Outgoing,
  type Place,
  post,
  refused,
  SendError,
} from "./destination.ts";

const TEXT_CHARS = 100_000;

// For whatever the user runs, such as n8n, Home Assistant or a script: plain JSON.
async function send(message: Outgoing, place: Place<"webhook">) {
  const url = place.keys.url;
  if (url === undefined) throw new SendError("it has no address", false);
  const response = await post(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: message.kind,
      title: message.title,
      text: message.text.slice(0, TEXT_CHARS),
      sentAt: new Date().toISOString(),
    }),
  });
  if (response.ok) return {};
  throw refused(response, `the address answered ${response.status}`);
}

export const webhook: Destination<"webhook"> = {
  kind: "webhook",
  service: "Webhook",
  keys: ["url"],
  gapMs: 500,
  send,
};
