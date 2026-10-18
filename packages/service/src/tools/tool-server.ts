import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { appsToolServer, teamToolServer } from "@office-town/contract";
import type { ToolServer } from "@office-town/harness";
import { z } from "zod";
import type { ToolAccess } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, type Endpoint, type Tool, ToolError, type ToolResult } from "./tools.ts";

const BODY_LIMIT_BYTES = 1024 * 1024;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const messageSchema = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.looseObject({}).optional(),
});

const callSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

// The hub's tools, and each connector's endpoint by its slug (D-67).
export interface AppTools {
  hub: readonly Tool[];
  endpointOf(slug: string): Endpoint | undefined;
}

export interface RunningToolServer extends ToolAccess {
  url: string;
  offer(tools: readonly Tool[]): void;
  offerApps(apps: AppTools): void;
  close(): Promise<void>;
}

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export const unknownTool = (name: string) =>
  new RpcError(INVALID_PARAMS, `Unknown tool "${name}".`);

// Anything but a refusal or a malformed call is a bug in the core, so it is logged here.
function rpcErrorOf(error: unknown): { code: number; message: string } {
  if (error instanceof RpcError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: INVALID_PARAMS, message: z.prettifyError(error) };
  console.error(error);
  return { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) };
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const asResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

// The core's own tools, each offered to the callers it suits.
function toolEndpoint(name: string, tools: () => readonly Tool[]): Endpoint {
  const offered = (caller: Caller) => tools().filter((tool) => tool.offeredTo(caller));
  return {
    name,
    list: (caller) =>
      offered(caller).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.input),
      })),
    async call(name, given, caller) {
      const tool = offered(caller).find((known) => known.name === name);
      if (tool === undefined) throw unknownTool(name);
      const input = tool.input.safeParse(given);
      try {
        if (!input.success) throw new ToolError(z.prettifyError(input.error));
        const result = await tool.call(input.data, caller);
        return typeof result === "string" ? asResult(result) : result;
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        return { ...asResult(error.message), isError: true };
      }
    },
  };
}

interface Grant {
  sessionId: string | undefined;
  // The connectors its conversation was given, by slug.
  slugs: readonly string[];
}

const APP_PATH = /^\/mcp\/apps\/([a-z0-9-]+)$/;

// It never pushes, so GET is refused. Its own port, so neither token opens the other (D-39).
export async function startToolServer(store: Store, port = 0): Promise<RunningToolServer> {
  const grantsByToken = new Map<string, Grant>();
  const tokensBySession = new Map<string, string>();
  let tools: readonly Tool[] = [];
  let apps: AppTools = { hub: [], endpointOf: () => undefined };
  const team = toolEndpoint(teamToolServer, () => tools);
  const hub = toolEndpoint(appsToolServer, () => apps.hub);

  const callerOf = (request: IncomingMessage): { caller: Caller; grant: Grant } | undefined => {
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
    const grant = token === undefined ? undefined : grantsByToken.get(token);
    const sessionId = grant?.sessionId;
    const session = sessionId === undefined ? undefined : store.getSession(sessionId);
    if (grant === undefined || session === undefined) return undefined;
    return {
      caller: { sessionId: session.id, agentId: session.agentId, taskId: session.taskId },
      grant,
    };
  };

  // A connector's endpoint opens only to a session whose conversation was given it.
  const endpointOf = (path: string, grant: Grant): Endpoint | undefined => {
    if (path === "/mcp") return team;
    if (path === "/mcp/apps") return hub;
    const slug = APP_PATH.exec(path)?.[1];
    if (slug === undefined || !grant.slugs.includes(slug)) return undefined;
    return apps.endpointOf(slug);
  };

  const answer = async (
    endpoint: Endpoint,
    method: string,
    params: unknown,
    caller: Caller,
  ): Promise<unknown> => {
    switch (method) {
      case "initialize": {
        const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const protocolVersion =
          typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0];
        return {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: endpoint.name, version: "1" },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: endpoint.list(caller) };
      case "tools/call": {
        const { name, arguments: given } = callSchema.parse(params);
        return endpoint.call(name, given, caller);
      }
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const known = callerOf(request);
    if (known === undefined) {
      response.writeHead(401).end();
      return;
    }
    const endpoint = endpointOf(new URL(request.url ?? "/", url).pathname, known.grant);
    if (endpoint === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const body = await readBody(request);
    if (body === undefined) {
      response.writeHead(413).end();
      return;
    }
    const message = messageSchema.safeParse(JSON.parse(body));
    if (!message.success) {
      response.writeHead(400).end();
      return;
    }
    const { id, method, params } = message.data;
    if (id === undefined) {
      response.writeHead(202).end();
      return;
    }
    try {
      const result = await answer(endpoint, method, params, known.caller);
      json(response, 200, { jsonrpc: "2.0", id, result });
    } catch (error) {
      json(response, 200, { jsonrpc: "2.0", id, error: rpcErrorOf(error) });
    }
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(400).end();
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

  return {
    url,
    offer(offered) {
      tools = offered;
    },
    offerApps(offered) {
      apps = offered;
    },
    // A connector deleted since its conversation began is left out.
    grant(connectorIds) {
      const token = randomBytes(32).toString("base64url");
      const slugs = connectorIds.flatMap((id) => store.getConnector(id)?.setup.slug ?? []);
      const grant: Grant = { sessionId: undefined, slugs };
      grantsByToken.set(token, grant);
      const servers: ToolServer[] = [
        { name: teamToolServer, url, token },
        { name: appsToolServer, url: `${url}/apps`, token },
        ...slugs.map((slug) => ({ name: slug, url: `${url}/apps/${slug}`, token })),
      ];
      return {
        servers,
        bind(sessionId) {
          grant.sessionId = sessionId;
          tokensBySession.set(sessionId, token);
        },
      };
    },
    revoke(sessionId) {
      const token = tokensBySession.get(sessionId);
      tokensBySession.delete(sessionId);
      if (token !== undefined) grantsByToken.delete(token);
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
