import type { HarnessCatalog } from "@office-town/contract";
import { type ApiServer, startApiServer } from "../../src/api/server.ts";
import { SessionActivity } from "../../src/registry/activity.ts";
import { SessionRegistry } from "../../src/registry/session-registry.ts";
import { openStore } from "../../src/store/sqlite-store.ts";
import type { Store } from "../../src/store/store.ts";
import { cachedCatalogs } from "../../src/team/catalogs.ts";
import { delegate, teamStatus } from "../../src/team/delegate.ts";
import type { TeamContext } from "../../src/team/members.ts";
import { proposeTeam } from "../../src/team/propose-team.ts";
import { reportResults } from "../../src/team/results.ts";
import { askUser } from "../../src/tools/ask-user.ts";
import { type RunningToolServer, startToolServer } from "../../src/tools/tool-server.ts";
import { FakeSession } from "./fake-session.ts";

const TOKEN = "test-token";

export const catalogs: Record<string, HarnessCatalog> = {
  claude: { models: [{ id: "haiku", name: "Haiku", efforts: [] }] },
  opencode: {
    models: [{ id: "opencode-go/free-model", name: "Free", access: "free", efforts: ["low"] }],
  },
};

export interface Core {
  store: Store;
  registry: SessionRegistry;
  tools: RunningToolServer;
  team: TeamContext;
  sessions: FakeSession[];
  // A test reads the few fields it checks; the schemas are proven by the contract tests.
  // biome-ignore lint/suspicious/noExplicitAny: a test reading JSON replies
  call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }>;
  callTool(session: FakeSession | undefined, name: string, input: object): Promise<ToolReply>;
  close(): Promise<void>;
}

export interface ToolReply {
  text: string;
  isError: boolean;
}

// The core as main.ts wires it, with harness sessions the test plays and catalogs it makes up.
export async function startCore(dataFolder: string): Promise<Core> {
  const store = openStore(dataFolder);
  const tools = await startToolServer(store);
  const sessions: FakeSession[] = [];
  const registry = new SessionRegistry(
    store,
    (_options, extras) => {
      const session = new FakeSession(extras);
      sessions.push(session);
      return session;
    },
    tools,
  );
  const readCatalog = cachedCatalogs(async (harness) => {
    const catalog = catalogs[harness];
    if (catalog === undefined) throw new Error("not installed");
    return catalog;
  });
  const team = { store, registry, readCatalog };
  const activity = new SessionActivity(registry);
  reportResults(team, activity);
  tools.offer([askUser(registry), proposeTeam(team), delegate(team), teamStatus(team, activity)]);
  const server: ApiServer = await startApiServer({
    registry,
    store,
    readCatalog,
    token: TOKEN,
    port: 0,
  });

  return {
    store,
    registry,
    tools,
    team,
    sessions,
    async call(method, path, body) {
      const response = await fetch(`${server.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = response.status === 204 ? {} : await response.json();
      return { status: response.status, json };
    },
    async callTool(session, name, input) {
      const response = await fetch(tools.url, {
        method: "POST",
        headers: { authorization: `Bearer ${session?.extras.toolServers?.[0]?.token}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: input },
        }),
      });
      const { result, error } = (await response.json()) as {
        result?: { content: { text: string }[]; isError?: boolean };
        error?: { message: string };
      };
      // A tool not offered to the caller is refused as unknown.
      if (result === undefined) return { text: error?.message ?? "", isError: true };
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    async close() {
      await server.close();
      await registry.close();
      await tools.close();
      store.close();
    },
  };
}

// A turn of a session the test plays: the agent says something, and the turn ends.
export function playTurn(
  session: FakeSession | undefined,
  text: string,
  outcome: "completed" | "failed" | "interrupted" = "completed",
): void {
  session?.emit({ type: "turn.started", payload: { turnId: "turn" } });
  session?.emit({ type: "message", payload: { role: "assistant", text } });
  session?.emit({ type: "turn.ended", payload: { turnId: "turn", outcome } });
}

// The core's reactions to an event are promises; this lets them settle.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
