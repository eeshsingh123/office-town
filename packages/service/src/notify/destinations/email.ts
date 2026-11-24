import {
  type Destination,
  fullText,
  type Outgoing,
  type Place,
  post,
  refused,
  SendError,
} from "./destination.ts";

export const RESEND_API = "https://api.resend.com";
// Without a domain of its own, Resend sends only to the account's own address, from this one.
const TRYING_FROM = "Office Town <onboarding@resend.dev>";
const BODY_CHARS = 200_000;

function reasonOf(status: number, said: string | undefined): string {
  if (status !== 401 && status !== 403) return `Resend said "${said ?? status}"`;
  return said?.includes("own email") === true
    ? "Resend sends only to your own address until you add a domain"
    : "the Resend key was refused";
}

// Plain text only, so an agent's words can't hide a link.
async function send(message: Outgoing, place: Place<"email">) {
  const key = place.keys.key;
  if (key === undefined) throw new SendError("it has no Resend key", false);
  const { to, from } = place.settings;
  const response = await post(`${place.base ?? RESEND_API}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: from ?? TRYING_FROM,
      to: [to],
      subject: message.title,
      text: fullText(message).slice(0, BODY_CHARS),
    }),
  });
  if (response.ok) return;
  const reply = (await response.json().catch(() => ({}))) as { message?: string };
  throw refused(response, reasonOf(response.status, reply.message));
}

export const email: Destination<"email"> = {
  kind: "email",
  service: "Email",
  keys: ["key"],
  gapMs: 1_000,
  send,
};
