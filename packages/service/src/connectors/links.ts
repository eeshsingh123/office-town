import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectorSetup, ConnectorStatus } from "@office-town/contract";
import type { ConnectorTool } from "../store/store.ts";
import type { ToolResult } from "../tools/tools.ts";
import { readKeys, type Secrets } from "./secrets.ts";

const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 60_000;
// Some apps take long, such as a render; progress notes keep a call alive past this.
const CALL_TIMEOUT_MS = 5 * 60_000;

// A connection that failed before saving, or a Claude app's sign-in that could not start.
export class ConnectError extends Error {
  constructor(name: string, error: unknown) {
    super(
      `Could not connect to ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    this.name = "ConnectError";
  }
}

class AppUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUnreachableError";
  }
}

// An "Authorization" key is sent as a bearer token; any other names its own header.
function headersOf(setup: ConnectorSetup, keys: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    setup.keys.flatMap(({ name }) => {
      const value = keys[name];
      if (value === undefined) return [];
      return [[name, name.toLowerCase() === "authorization" ? `Bearer ${value}` : value]];
    }),
  );
}

// The SDK's own classes miss its Transport type under exactOptionalPropertyTypes, hence the casts.
function transportOf(setup: ConnectorSetup, keys: Record<string, string>): Transport {
  if (setup.kind === "local") {
    // Keys go in the environment, never on the command line, where others could read them.
    return new StdioClientTransport({
      command: setup.command ?? "",
      args: setup.args ?? [],
      env: keys,
    }) as Transport;
  }
  return new StreamableHTTPClientTransport(new URL(setup.url ?? ""), {
    requestInit: { headers: headersOf(setup, keys) },
  }) as Transport;
}

async function listTools(client: Client): Promise<ConnectorTool[]> {
  const tools: ConnectorTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? {} : { cursor });
    tools.push(...(page.tools as ConnectorTool[]));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

async function connect(transport: Transport, onToolsChanged?: (client: Client) => void) {
  const client = new Client({ name: "Office Town", version: "1" });
  if (onToolsChanged !== undefined) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => onToolsChanged(client));
  }
  await client.connect(transport);
  return client;
}

export interface LinkListener {
  tools(connectorId: string, tools: ConnectorTool[]): void;
  status(connectorId: string, status: Extract<ConnectorStatus, "connected" | "failing">): void;
}

interface Reachable {
  id: string;
  setup: ConnectorSetup;
}

// One live link per connector, shared by every agent; a local program starts on first use.
export class ConnectorLinks {
  readonly #secrets: Secrets;
  readonly #listener: LinkListener;
  readonly #clients = new Map<string, Promise<Client>>();
  readonly #retries = new Map<string, { at: number; delay: number }>();

  constructor(secrets: Secrets, listener: LinkListener) {
    this.#secrets = secrets;
    this.#listener = listener;
  }

  // Connects once and keeps the list it reads.
  async refresh(connector: Reachable): Promise<ConnectorTool[]> {
    const tools = await listTools(await this.#client(connector));
    this.#listener.tools(connector.id, tools);
    return tools;
  }

  async call(
    connector: Reachable,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const client = await this.#client(connector);
    try {
      return (await client.callTool({ name: tool, arguments: input }, undefined, {
        timeout: CALL_TIMEOUT_MS,
        resetTimeoutOnProgress: true,
      })) as ToolResult;
    } catch (error) {
      // A broken link is opened again on the next call; an app's own error leaves it.
      if (!client.transport) await this.drop(connector.id);
      throw error;
    }
  }

  async drop(id: string): Promise<void> {
    const client = this.#clients.get(id);
    this.#clients.delete(id);
    this.#retries.delete(id);
    await client?.then((open) => open.close()).catch(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#clients.keys()].map((id) => this.drop(id)));
  }

  #client(connector: Reachable): Promise<Client> {
    const open = this.#clients.get(connector.id);
    if (open !== undefined) return open;
    const retry = this.#retries.get(connector.id);
    if (retry !== undefined && Date.now() < retry.at) {
      const seconds = Math.ceil((retry.at - Date.now()) / 1000);
      return Promise.reject(
        new AppUnreachableError(`It did not answer; trying again in ${seconds}s.`),
      );
    }
    const opening = this.#open(connector, retry?.delay ?? 0);
    this.#clients.set(connector.id, opening);
    // A link the app or the program closed is opened again on the next use.
    opening.then(
      (client) => {
        client.onclose = () => {
          if (this.#clients.get(connector.id) === opening) this.#clients.delete(connector.id);
        };
      },
      () => undefined,
    );
    return opening;
  }

  async #open({ id, setup }: Reachable, lastDelay: number): Promise<Client> {
    try {
      const client = await connect(transportOf(setup, readKeys(this.#secrets, id)), (changed) => {
        listTools(changed)
          .then((tools) => this.#listener.tools(id, tools))
          .catch((error: unknown) => console.error(`Connector ${setup.name}:`, error));
      });
      this.#retries.delete(id);
      this.#listener.status(id, "connected");
      return client;
    } catch (error) {
      this.#clients.delete(id);
      const delay = Math.min(Math.max(lastDelay * 2, FIRST_RETRY_MS), LAST_RETRY_MS);
      this.#retries.set(id, { at: Date.now() + delay, delay });
      this.#listener.status(id, "failing");
      throw new AppUnreachableError(error instanceof Error ? error.message : String(error));
    }
  }
}

// Tries an app before it is saved: connects, lists its tools and closes.
export async function probe(setup: ConnectorSetup, keys: Record<string, string>) {
  const client = await connect(transportOf(setup, keys));
  try {
    return await listTools(client);
  } finally {
    await client.close();
  }
}
