import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { eventStreamQuerySchema } from "@office-town/contract";
import type { ConnectorHub } from "../connectors/hub.ts";
import type { TeamContext } from "../team/members.ts";
import { RequestError, toErrorReply } from "./errors.ts";
import { streamEvents } from "./event-stream.ts";
import { apiRoutes, type Reply, type Route } from "./routes.ts";

const BODY_LIMIT_BYTES = 1024 * 1024;

export interface ApiOptions {
  team: TeamContext;
  connectors: ConnectorHub;
  // Anything on this machine can reach the port, but not the token.
  token: string;
  // 0 picks a free port.
  port: number;
}

export interface ApiServer {
  url: string;
  close(): Promise<void>;
}

interface MatchedRoute {
  route: Route;
  params: Map<string, string>;
}

function matchRoute(routes: Route[], method: string, path: string): MatchedRoute | undefined {
  const segments = path.split("/");
  for (const route of routes) {
    const pattern = route.path.split("/");
    if (route.method !== method || pattern.length !== segments.length) continue;
    const params = new Map<string, string>();
    const matches = pattern.every((part, index) => {
      const segment = segments[index] ?? "";
      if (!part.startsWith(":")) return part === segment;
      params.set(part.slice(1), decodeURIComponent(segment));
      return segment !== "";
    });
    if (matches) return { route, params };
  }
  return undefined;
}

async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      const mebibytes = limit / (1024 * 1024);
      throw new RequestError(413, "too_large", `The request body is larger than ${mebibytes} MiB.`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBytes(request, BODY_LIMIT_BYTES);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid_request", "The request body is not valid JSON.");
  }
}

function send(response: ServerResponse, reply: Reply): void {
  if (reply.status === 204) {
    response.writeHead(204).end();
    return;
  }
  if ("text" in reply) {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(reply.text);
    return;
  }
  response
    .writeHead(reply.status, { "content-type": "application/json" })
    .end(JSON.stringify(reply.json));
}

// Where an app sends the browser after its sign-in page; plain words, as the user reads it there.
async function signInPage(
  response: ServerResponse,
  connectors: ConnectorHub,
  query: URLSearchParams,
): Promise<void> {
  const page = (text: string) =>
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        `<!doctype html><title>Office Town</title><p style="font: 16px system-ui; margin: 48px">${text}</p>`,
      );
  const state = query.get("state") ?? "";
  const code = query.get("code");
  if (code === null) {
    page("The sign-in was not finished. You can close this tab and try again in Office Town.");
    return;
  }
  try {
    const name = await connectors.finishSignIn(state, code);
    page(
      name === undefined
        ? "This sign-in link has expired. Start again from Office Town."
        : "You are signed in. You can close this tab and go back to Office Town.",
    );
  } catch (error) {
    console.error("A connector sign-in failed.", error);
    page("The sign-in did not work. You can close this tab and try again in Office Town.");
  }
}

export async function startApiServer(options: ApiOptions): Promise<ApiServer> {
  const { team, connectors, token, port } = options;
  const { registry, store } = team;
  const routes = apiRoutes(team, connectors);
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (request: IncomingMessage): boolean => {
    const given = Buffer.from(request.headers.authorization ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // The app's sign-in page sends the browser here, without a token; the one-time state is the key.
    if (request.method === "GET" && url.pathname === "/connectors/callback") {
      await signInPage(response, connectors, url.searchParams);
      return;
    }
    if (!authorized(request)) {
      throw new RequestError(401, "unauthorized", "A valid bearer token is required.");
    }
    const method = request.method ?? "";
    if (method === "GET" && url.pathname === "/events") {
      const lastEventId = request.headers["last-event-id"];
      const query = eventStreamQuerySchema.parse({
        ...Object.fromEntries(url.searchParams),
        ...(typeof lastEventId === "string" ? { after: lastEventId } : {}),
      });
      await streamEvents(response, { registry, store }, query);
      return;
    }
    const matched = matchRoute(routes, method, url.pathname);
    if (matched === undefined) {
      throw new RequestError(404, "not_found", `No route for ${method} ${url.pathname}.`);
    }
    const reply = await matched.route.reply({
      param: (name) => matched.params.get(name) ?? "",
      query: url.searchParams,
      body: () => readJson(request),
      bytes: (limit) => readBytes(request, limit),
    });
    send(response, reply);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const { status, body } = toErrorReply(error);
      // Once a stream has started, the only way left to report a failure is to cut it.
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const { port: bound } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${bound}`,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      // Event streams never end by themselves.
      server.closeAllConnections();
      await closed;
    },
  };
}
