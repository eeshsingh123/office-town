import {
  cut,
  type Destination,
  fullText,
  type Outgoing,
  type Place,
  post,
  refused,
  SendError,
} from "./destination.ts";

// ntfy turns a message over 4,096 bytes into a file itself; this sends it as one, with its start
// as the message. ntfy.sh takes files up to 15 MB.
const MESSAGE_BYTES = 4_096;

function reasonOf(status: number): string {
  if (status === 401 || status === 403) return "the topic's access token was refused";
  if (status === 413) return "the result was too big for this ntfy server";
  return `ntfy answered ${status}`;
}

// The title and the rest go in the address, which takes any text, unlike a header.
async function send(message: Outgoing, place: Place<"ntfy">) {
  const topic = place.keys.topic;
  if (topic === undefined) throw new SendError("it has no topic", false);
  const text = message.text === "" ? message.title : message.text;
  const long = Buffer.byteLength(text) > MESSAGE_BYTES;
  const address = new URL(
    `${place.settings.server.replace(/\/$/, "")}/${encodeURIComponent(topic)}`,
  );
  address.searchParams.set("title", message.title);
  if (message.kind === "alert" || message.kind === "ask") address.searchParams.set("priority", "4");
  if (long) {
    address.searchParams.set("filename", "result.md");
    address.searchParams.set("message", cut(text, 300));
  }
  const token = place.keys.token;
  const response = await post(address.href, {
    method: long ? "PUT" : "POST",
    body: long ? fullText(message) : text,
    ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
  });
  if (response.ok) return;
  throw refused(response, reasonOf(response.status));
}

export const ntfy: Destination<"ntfy"> = {
  kind: "ntfy",
  service: "ntfy",
  keys: ["topic", "token?"],
  gapMs: 2_000,
  send,
};
