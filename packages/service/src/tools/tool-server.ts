import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { teamToolServer } from "@office-town/contract";
import type { ToolServer } from "@office-town/harness";
import { z } from "zod";
import type { ToolAccess } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, type Tool, ToolError } from "./tools.ts";

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

export interface RunningToolServer extends ToolAccess {
  url: string;
  offer(tools: readonly Tool[]): void;
  close(): Promise<void>;
}

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

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

// The core's own MCP server (D-39): one JSON-RPC message per POST, answered with JSON. It never
// pushes, so GET is refused, which clients read as "no stream". It listens apart from the API, so
// neither one's token opens the other.
export async function startToolServer(store: Store, port = 0): Promise<RunningToolServer> {
  const sessionsByToken = new Map<string, string | undefined>();
  const tokensBySession = new Map<string, string>();
  let tools: readonly Tool[] = [];

  const callerOf = (request: IncomingMessage): Caller | undefined => {
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
    const sessionId = token === undefined ? undefined : sessionsByToken.get(token);
    const session = sessionId === undefined ? undefined : store.getSession(sessionId);
    if (session === undefined) return undefined;
    return { sessionId: session.id, agentId: session.agentId, taskId: session.taskId };
  };

  const callTool = async (params: unknown, caller: Caller) => {
    const { name, arguments: given } = callSchema.parse(params);
    const tool = tools.find((known) => known.name === name && known.offeredTo(caller));
    if (tool === undefined) throw new RpcError(INVALID_PARAMS, `Unknown tool "${name}".`);
    const input = tool.input.safeParse(given);
    try {
      if (!input.success) throw new ToolError(z.prettifyError(input.error));
      return { content: [{ type: "text", text: await tool.call(input.data, caller) }] };
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
  };

  const answer = async (method: string, params: unknown, caller: Caller): Promise<unknown> => {
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
          serverInfo: { name: teamToolServer, version: "1" },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: tools
            .filter((tool) => tool.offeredTo(caller))
            .map(({ name, description, input }) => ({
              name,
              description,
              inputSchema: z.toJSONSchema(input),
            })),
        };
      case "tools/call":
        return callTool(params, caller);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const caller = callerOf(request);
    if (caller === undefined) {
      response.writeHead(401).end();
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
      json(response, 200, { jsonrpc: "2.0", id, result: await answer(method, params, caller) });
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
    grant() {
      const token = randomBytes(32).toString("base64url");
      sessionsByToken.set(token, undefined);
      const servers: ToolServer[] = [{ name: teamToolServer, url, token }];
      return {
        servers,
        bind(sessionId) {
          sessionsByToken.set(token, sessionId);
          tokensBySession.set(sessionId, token);
        },
      };
    },
    revoke(sessionId) {
      const token = tokensBySession.get(sessionId);
      tokensBySession.delete(sessionId);
      if (token !== undefined) sessionsByToken.delete(token);
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
