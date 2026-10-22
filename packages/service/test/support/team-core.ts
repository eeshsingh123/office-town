import { type HarnessCatalog, teamToolServer } from "@office-town/contract";
import { UnknownHarnessError } from "@office-town/harness";
import { permissionModeOf } from "../../src/agents/options.ts";
import { type ApiServer, startApiServer } from "../../src/api/server.ts";
import { autonomyGuard } from "../../src/autonomy/policy.ts";
import { messageLead } from "../../src/chief/message-lead.ts";
import { proposePlan } from "../../src/chief/propose-plan.ts";
import { Scheduler } from "../../src/chief/scheduler.ts";
import { appsOf } from "../../src/connectors/access.ts";
import { ConnectorHub } from "../../src/connectors/hub.ts";
import { AppRequests } from "../../src/connectors/request-app.ts";
import { referenceOf } from "../../src/library/library.ts";
import { addToLibrary, changeLibrary } from "../../src/library/library-tools.ts";
import { followLibraryUses } from "../../src/library/library-uses.ts";
import { PreviewServer } from "../../src/outputs/preview-server.ts";
import { showResult } from "../../src/outputs/show-result.ts";
import { TaskFiles } from "../../src/outputs/task-files.ts";
import { SessionActivity } from "../../src/registry/activity.ts";
import {
  type HarnessSessionFactory,
  SessionRegistry,
} from "../../src/registry/session-registry.ts";
import { openStore } from "../../src/store/sqlite-store.ts";
import type { Store } from "../../src/store/store.ts";
import { cachedCatalogs } from "../../src/team/catalogs.ts";
import { Checks } from "../../src/team/checks.ts";
import { delegate, teamStatus } from "../../src/team/delegate.ts";
import { Handovers } from "../../src/team/handover.ts";
import type { TeamContext } from "../../src/team/members.ts";
import { proposeTeam } from "../../src/team/propose-team.ts";
import { reportResults } from "../../src/team/results.ts";
import { resumeWork, stopWork } from "../../src/team/stop-work.ts";
import { TaskStates } from "../../src/team/task-state.ts";
import { UsagePauses } from "../../src/team/usage-pause.ts";
import { cleanUpWorktrees } from "../../src/team/worktrees.ts";
import { askUser } from "../../src/tools/ask-user.ts";
import { type RunningToolServer, startToolServer } from "../../src/tools/tool-server.ts";
import { memorySecrets } from "./connectors.ts";
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
  connectors: ConnectorHub;
  secrets: ReturnType<typeof memorySecrets>;
  scheduler: Scheduler;
  sessions: FakeSession[];
  // biome-ignore lint/suspicious/noExplicitAny: a test reading JSON replies
  call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }>;
  // On the team's server unless another of the session's servers is named.
  callTool(
    session: FakeSession | undefined,
    name: string,
    input: object,
    server?: string,
  ): Promise<ToolReply>;
  close(): Promise<void>;
}

export interface ToolReply {
  text: string;
  isError: boolean;
}

// The core as main.ts wires it, with harness sessions the test plays and catalogs it makes up.
export async function startCore(dataFolder: string): Promise<Core> {
  const store = openStore(dataFolder);
  const taskStates = new TaskStates(store);
  const tools = await startToolServer(store);
  const sessions: FakeSession[] = [];
  // Model "broken" fails to start; a harness with no catalog is refused, as the real factory does.
  const createSession: HarnessSessionFactory = (options, extras) => {
    if (catalogs[options.harness] === undefined) throw new UnknownHarnessError(options.harness);
    const session = new FakeSession(extras, options.model === "broken");
    sessions.push(session);
    return session;
  };
  const registry = new SessionRegistry(store, {
    createSession,
    tools,
    guard: autonomyGuard(store),
    permissionModeOf: (agentId) => permissionModeOf(store, agentId),
    referenceOf: referenceOf(store),
    appsOf: appsOf(store),
    appGuard: (session, request) => connectors.claudeApps.decide(session, request),
  });
  const secrets = memorySecrets();
  const connectors = new ConnectorHub(store, registry, secrets);
  tools.offerApps({
    hub: connectors.gateway.hubTools(),
    endpointOf: (slug) => connectors.gateway.endpointOf(slug),
  });
  taskStates.follow(registry);
  followLibraryUses(registry, store);
  const readCatalog = cachedCatalogs(async (harness) => {
    const catalog = catalogs[harness];
    if (catalog === undefined) throw new Error("not installed");
    return catalog;
  });
  const team = { store, registry, readCatalog, dataFolder, createSession };
  const activity = new SessionActivity(registry);
  reportResults(team, activity);
  const handovers = new Handovers(team);
  const pauses = new UsagePauses(team);
  cleanUpWorktrees(team);
  const checks = new Checks(team);
  const scheduler = new Scheduler(team);
  tools.offer([
    askUser(registry),
    proposeTeam(team),
    delegate(team),
    teamStatus(team, activity),
    stopWork(team, activity),
    resumeWork(team),
    handovers.tool(),
    checks.writeChecklistTool(),
    checks.proposeChecksTool(),
    checks.reportCheckTool(),
    proposePlan(team, scheduler),
    messageLead(team),
    addToLibrary(team),
    changeLibrary(team),
    new AppRequests(store, registry).tool(),
    showResult(team),
  ]);
  const preview = await PreviewServer.start();
  const server: ApiServer = await startApiServer({
    team,
    connectors,
    pauses,
    checks,
    outputs: { preview, files: new TaskFiles(store), ownPorts: new Set([preview.port]) },
    token: TOKEN,
    port: 0,
  });

  return {
    store,
    registry,
    tools,
    team,
    connectors,
    secrets,
    scheduler,
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
    async callTool(session, name, input, server = teamToolServer) {
      const attached = session?.extras.toolServers?.find((each) => each.name === server);
      const response = await fetch(attached?.url ?? tools.url, {
        method: "POST",
        headers: { authorization: `Bearer ${attached?.token}` },
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
      await preview.close();
      await registry.close();
      await tools.close();
      await connectors.close();
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

// Waits for something the core does in the background, such as running git, for up to 10 seconds.
export async function eventually(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries += 1) await settle();
}
