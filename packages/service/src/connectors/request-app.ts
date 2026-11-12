import { randomUUID } from "node:crypto";
import {
  type AgentRecord,
  type AppAsk,
  type AppAudience,
  type Audience,
  appAudienceSchema,
  appKeyOf,
  type CatalogEntry,
  type ConnectorRecord,
  providerOf,
  type SessionRecord,
} from "@office-town/contract";
import { hasVendorApps } from "@office-town/harness";
import { z } from "zod";
import { sessionAccountId } from "../accounts/accounts.ts";
import { AnswerError, type SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isProviderApp, mayUse, reachableApps } from "./access.ts";
import { catalog } from "./catalog.ts";

interface Waiting {
  sessionId: string;
  requestId: string;
  agentId: string;
  // The app as the ask names it, matched against a connector added later.
  key: string;
  audience: AppAudience;
}

// Sent by the core alone, once the user connected the app.
const CONNECTED = "connected";
const GIVE = "give:";

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};

// Who gets the app: the asker, its department (by default), or everyone (D-96).
function widened(audience: Audience, agent: AgentRecord, wanted: AppAudience): Audience {
  if (wanted === "everyone") return { everyone: true, departmentIds: [], agentIds: [] };
  if (wanted === "department" && agent.departmentId !== undefined) {
    return audience.departmentIds.includes(agent.departmentId)
      ? audience
      : { ...audience, departmentIds: [...audience.departmentIds, agent.departmentId] };
  }
  return audience.agentIds.includes(agent.id)
    ? audience
    : { ...audience, agentIds: [...audience.agentIds, agent.id] };
}

const sameApp = (key: string) => (connector: ConnectorRecord) =>
  connector.setup.slug === key || appKeyOf(connector.setup.name) === key;

const entryOf = (key: string): CatalogEntry | undefined =>
  catalog.find(({ setup }) => setup.slug === key || appKeyOf(setup.name) === key);

// The ways an app reaches an agent on this session: a shared app first, then its provider's app on
// the session's login (D-96).
function routesFor(store: Store, session: SessionRecord, key: string) {
  const found = store.listConnectors().filter(sameApp(key));
  const { harness } = session.options;
  const accountId = sessionAccountId(session.options);
  return {
    shared: found.find((connector) => !isProviderApp(connector)),
    own: found.find(
      ({ setup }) => providerOf(setup.kind) === harness && setup.account === accountId,
    ),
  };
}

// Whether the agent's provider can sign in to the app itself, as Add would offer it.
function providerCanAdd(harness: string, entry: CatalogEntry | undefined): boolean {
  if (!hasVendorApps(harness) || PROVIDER_NAMES[harness] === undefined) return false;
  if (entry === undefined) return harness !== "opencode";
  return providerOf(entry.setup.kind) === harness || entry.signIn.includes(harness);
}

// An agent without an app asks for it; the user connects it or gives access from Needs you. A
// shared app is then reached through use_app_tool, so the tool list stays as it was (D-67). A
// provider app reaches an agent only from a new conversation, so the agent carries on in one with
// its handover (D-94, D-96). An app no way reaches is passed to a teammate who has it.
export class AppRequests {
  readonly #store: Store;
  readonly #registry: SessionRegistry;
  readonly #carryOn: (sessionId: string) => void;
  // Asks answered by connecting the app, which the user does from the ask's card.
  readonly #connecting = new Map<string, Waiting>();

  constructor(
    store: Store,
    registry: SessionRegistry,
    carryOn: (sessionId: string) => void = () => undefined,
  ) {
    this.#store = store;
    this.#registry = registry;
    this.#carryOn = carryOn;
    store.subscribe((change) => {
      if (change.type === "connector") this.#connected(change.connector);
    });
  }

  tool() {
    return defineTool({
      name: "request_app",
      description:
        "Ask the user for an app you need, such as Notion or GitHub, and say why. " +
        "list_app_tools names the apps you can ask for. It returns at once; the user's answer " +
        "reaches you by message.",
      input: z.object({
        app: z.string().trim().min(1).max(60),
        reason: z.string().trim().min(1),
        for: appAudienceSchema
          .optional()
          .describe('Who should get it: "agent" (you), "department" (default) or "everyone".'),
      }),
      offeredTo: (caller) => this.#store.getAgent(caller.agentId)?.guest !== true,
      call: ({ app, reason, for: wanted }, caller) => this.#request(caller, app, reason, wanted),
    });
  }

  #request(caller: Caller, app: string, reason: string, wanted?: AppAudience): string {
    const agent = this.#store.getAgent(caller.agentId);
    const session = this.#store.getSession(caller.sessionId);
    if (agent === undefined || session === undefined) throw new ToolError("No such agent.");
    const { harness } = session.options;
    const entry = entryOf(appKeyOf(app));
    const key = entry?.setup.slug ?? appKeyOf(app);
    const { shared, own } = routesFor(this.#store, session, key);
    const name = entry?.setup.name ?? shared?.setup.name ?? own?.setup.name ?? app;
    const ready = (connector: ConnectorRecord | undefined): connector is ConnectorRecord =>
      connector !== undefined && connector.status === "connected";
    if (ready(shared) && mayUse(shared, agent)) {
      return `You already have ${name}. See its tools with list_app_tools.`;
    }
    if (ready(own) && mayUse(own, agent)) {
      if ((session.options.vendorApps ?? []).includes(own.setup.app ?? "")) {
        return `You already have ${name}; use its own tools.`;
      }
      this.#carryOn(session.id);
      return `${name} came after this conversation began. Call hand_over now to carry on in a new conversation that has it, then end your turn.`;
    }
    const give = ready(shared) ? shared : ready(own) ? own : undefined;
    // An app that can be shared is added in Office Town first, where Add also offers the
    // provider's own way in; otherwise the agent's provider sets it up.
    const sharedEntry =
      entry !== undefined && (entry.setup.kind === "remote" || entry.setup.kind === "local");
    const provider =
      give === undefined && !sharedEntry && providerCanAdd(harness, entry) ? harness : undefined;
    if (give === undefined && provider === undefined && !sharedEntry) {
      return this.#elsewhere(caller, agent, name, reason);
    }
    const suggested: AppAudience =
      wanted ?? (agent.departmentId === undefined ? "agent" : "department");
    const requestId = `app-request-${randomUUID()}`;
    const input: AppAsk = {
      app: name,
      reason,
      ...(provider === undefined ? {} : { provider }),
      suggested,
      ...(agent.departmentId === undefined ? {} : { departmentId: agent.departmentId }),
    };
    const audiences = appAudienceSchema.options.filter(
      (audience) => audience !== "department" || agent.departmentId !== undefined,
    );
    const setUp =
      provider === undefined
        ? `Connect ${name}`
        : own?.status === "signed_out"
          ? `Sign in again in ${PROVIDER_NAMES[provider]}`
          : `Set up in ${PROVIDER_NAMES[provider]}`;
    const options =
      give === undefined
        ? [{ optionId: "connect", label: setUp, kind: "allow_once" as const }]
        : audiences.map((audience) => ({
            optionId: `${GIVE}${audience}`,
            label: "Give access",
            kind: "allow_once" as const,
          }));
    this.#registry.ask(
      caller.sessionId,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title: `${agent.name} wants to use ${name}. ${reason}`,
          input,
          kind: "other",
          tool: { server: entry?.setup.slug ?? key, name: "request" },
          options: [...options, { optionId: "decline", label: "Decline", kind: "reject_once" }],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
        // The card's button opens the setup; the core answers once the app is connected.
        if (command.optionId === "connect") throw new AnswerError(`Set up ${name} from its card.`);
        const audience = command.optionId.startsWith(GIVE)
          ? appAudienceSchema.parse(command.optionId.slice(GIVE.length))
          : command.optionId === CONNECTED
            ? (this.#connecting.get(requestId)?.audience ?? suggested)
            : undefined;
        this.#connecting.delete(requestId);
        return {
          resolution: {
            type: "permission.resolved",
            payload: {
              requestId,
              outcome: audience === undefined ? "denied" : "allowed",
              optionId: command.optionId,
              answeredBy: "user",
            },
          },
          afterwards: () => this.#answered(caller.sessionId, agent.id, key, name, audience),
        };
      },
    );
    if (give === undefined) {
      this.#connecting.set(requestId, {
        sessionId: caller.sessionId,
        requestId,
        agentId: agent.id,
        key,
        audience: suggested,
      });
    }
    return `Your request for ${name} is with the user. Their answer will reach you as a message.`;
  }

  // The audience the user picked before setting the app up, kept for when it connects.
  chooseAudience(requestId: string, audience: AppAudience): void {
    const waiting = this.#connecting.get(requestId);
    if (waiting !== undefined) waiting.audience = audience;
  }

  async #answered(
    sessionId: string,
    agentId: string,
    key: string,
    name: string,
    audience: AppAudience | undefined,
  ) {
    const tell = (text: string, summary: string) =>
      this.#registry.tell(sessionId, { text, origin: { kind: "notice", summary } });
    if (audience === undefined) {
      await tell(`The user did not give you ${name}.`, `You declined ${name}`);
      return;
    }
    const session = this.#store.getSession(sessionId);
    const agent = this.#store.getAgent(agentId);
    if (session === undefined || agent === undefined) return;
    const { shared, own } = routesFor(this.#store, session, key);
    const connector = shared?.status === "connected" ? shared : own;
    if (connector === undefined) return;
    // An app just set up for this ask goes to whom the user chose; one that existed is widened.
    const fresh = Date.parse(connector.createdAt) >= Date.parse(session.createdAt);
    const base = fresh ? { everyone: false, departmentIds: [], agentIds: [] } : connector.audience;
    this.#store.updateConnector(connector.id, { audience: widened(base, agent, audience) });
    if (!isProviderApp(connector)) {
      await tell(
        `${name} is ready for you. See its tools with list_app_tools and call them with use_app_tool.`,
        `You gave it ${name}`,
      );
      return;
    }
    // A provider reads its apps once per conversation, so the agent carries on in a new one.
    this.#carryOn(sessionId);
    await tell(
      `${name} is ready, and it reaches you in a new conversation. Call hand_over now with everything the new conversation needs, then end your turn.`,
      `You gave it ${name}`,
    );
  }

  // No way reaches the agent: a teammate who has the app takes the step, or the user is told the
  // team has no one who can.
  #elsewhere(caller: Caller, agent: AgentRecord, name: string, reason: string): string {
    const department =
      agent.departmentId === undefined ? undefined : this.#store.getDepartment(agent.departmentId);
    const holders = this.#store
      .listAgents()
      .filter(
        (other) =>
          other.id !== agent.id &&
          other.departmentId !== undefined &&
          other.departmentId === agent.departmentId &&
          reachableApps(this.#store, other).includes(name),
      )
      .map((other) => other.name);
    const only = `Your provider cannot reach ${name}.`;
    if (holders.length > 0) {
      const how =
        department?.leadAgentId === agent.id
          ? "Hand this step to one of them with delegate."
          : "Ask your lead with message_lead to hand this step to one of them.";
      return `${only} ${holders.join(", ")} can use it. ${how}`;
    }
    const requestId = `app-request-${randomUUID()}`;
    this.#registry.ask(
      caller.sessionId,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title: `${agent.name} wants to use ${name}, which no one on the team can reach. ${reason}`,
          input: { app: name, reason },
          kind: "other",
          tool: { server: appKeyOf(name), name: "request" },
          options: [{ optionId: "decline", label: "OK", kind: "reject_once" }],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is a notice.");
        return {
          resolution: {
            type: "permission.resolved",
            payload: {
              requestId,
              outcome: "denied",
              optionId: command.optionId,
              answeredBy: "user",
            },
          },
          afterwards: () =>
            this.#answered(caller.sessionId, agent.id, appKeyOf(name), name, undefined),
        };
      },
    );
    return `${only} No one on your team can use it, and the user was told. Carry on without it.`;
  }

  // The user connected the app an agent asked for, so its ask is answered.
  #connected(connector: ConnectorRecord): void {
    if (connector.status !== "connected") return;
    for (const waiting of this.#connecting.values()) {
      if (!sameApp(waiting.key)(connector)) continue;
      const session = this.#store.getSession(waiting.sessionId);
      if (session === undefined || !this.#registry.isRunning(waiting.sessionId)) {
        this.#connecting.delete(waiting.requestId);
        continue;
      }
      const provider = providerOf(connector.setup.kind);
      if (provider !== undefined && provider !== session.options.harness) continue;
      this.#registry
        .send(waiting.sessionId, {
          type: "answerPermission",
          requestId: waiting.requestId,
          optionId: CONNECTED,
        })
        .catch((error: unknown) => console.error("Could not answer an app request.", error));
    }
  }
}

// What an agent can ask for, so it names the app as the user knows it (D-96).
export function askableApps(store: Store, agent: AgentRecord): string {
  const have = new Set(reachableApps(store, agent).map(appKeyOf));
  const names = [
    ...store.listConnectors().map(({ setup }) => setup.name),
    ...catalog.map(({ setup }) => setup.name),
  ].filter((name, index, all) => !have.has(appKeyOf(name)) && all.indexOf(name) === index);
  return names.length === 0 ? "" : `Apps you can ask for with request_app: ${names.join(", ")}.`;
}
