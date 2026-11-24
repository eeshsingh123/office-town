import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface Received {
  path: string;
  body: string;
}

export interface FakeServices {
  url: string;
  received: Received[];
  // What Telegram has for the bot's next long poll, while a link code waits.
  updates: object[];
  sentToTelegram(): { message_id: number; text?: string; reply_markup?: unknown }[];
  close(): Promise<void>;
}

const POLL_MS = 50;

// Telegram's Bot API and Slack webhooks, as far as the core uses them. A webhook whose address ends
// in `/gone` answers as one that was removed.
export async function startFakeServices(): Promise<FakeServices> {
  const received: Received[] = [];
  const updates: object[] = [];
  let nextUpdate = 1;
  let nextMessage = 100;
  const sent: { message_id: number; text?: string; reply_markup?: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const path = request.url ?? "";
    received.push({ path, body });
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (path.startsWith("/services/")) {
      if (!path.endsWith("/gone")) return reply(200, "ok");
      response.writeHead(404);
      return response.end("no_service");
    }
    const method = path.split("/").at(-1);
    if (method === "getUpdates") {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const given = updates.splice(0).map((update) => ({ update_id: nextUpdate++, ...update }));
      return reply(200, { ok: true, result: given });
    }
    if (method === "getMe") return reply(200, { ok: true, result: { username: "office_bot" } });
    if (method === "sendMessage" || method === "sendDocument") {
      const parsed = method === "sendMessage" ? (JSON.parse(body) as object) : {};
      const message = { message_id: nextMessage++, ...parsed };
      sent.push(message);
      return reply(200, { ok: true, result: message });
    }
    return reply(200, { ok: true, result: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    updates,
    sentToTelegram: () => sent,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
