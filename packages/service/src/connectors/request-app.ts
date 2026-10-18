import { randomUUID } from "node:crypto";
import type {
  AgentRecord,
  Audience,
  CatalogEntry,
  ConnectorRecord,
  SessionRecord,
} from "@office-town/contract";
import { hasVendorApps } from "@office-town/harness";
import { z } from "zod";
import { sessionAccountId } from "../accounts/accounts.ts";
import { AnswerError, type SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isClaudeApp, mayUse, reachableApps, reaches } from "./access.ts";
import { catalog } from "./catalog.ts";
import { findApps } from "./gateway.ts";

interface Waiting {
  sessionId: string;
  requestId: string;
  agentId: string;
  // The app as the ask names it, matched against a connector added later.
  names: string[];
}

// The asker's department, or the agent itself without one.
function withAsker(audience: Audience, agent: AgentRecord): Audience {
  if (reaches(audience, agent)) return audience;
  return agent.departmentId === undefined
    ? { ...audience, agentIds: [...audience.agentIds, agent.id] }
    : { ...audience, departmentIds: [...audience.departmentIds, agent.departmentId] };
}

// Sent by the core alone, once the user connected the app.
const CONNECTED = "connected";

const slugOf = (app: string) =>
  app
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 24);

// The record an agent would use for an app: a hub app, else the Claude app of the login its
// session runs on, else that app on another login.
function appFor(store: Store, session: SessionRecord | undefined, app: string) {
  const found = findApps(store, app);
  const hub = found.find((connector) => !isClaudeApp(connector));
  if (hub !== undefined) return hub;
  const accountId = session === undefined ? undefined : sessionAccountId(session.options);
  return found.find(({ setup }) => setup.account === accountId) ?? found[0];
}

const claudeOnly = (connector: ConnectorRecord | undefined, entry: CatalogEntry | undefined) =>
  connector === undefined ? entry?.setup.kind === "claude" : isClaudeApp(connector);

// An agent without an app asks for it; the user connects it or gives access from Needs you,
// and the agent then reaches it through use_app_tool, so its tool list stays as it was (D-67).
// A Claude app reaches only Claude agents, from their next conversation; another agent is
// pointed to a teammate who has it (D-68).
export class AppRequests {
  readonly #store: Store;
  readonly #registry: SessionRegistry;
  // Asks answered by connecting the app, which the user does in the connect sheet.
  readonly #connecting = new Map<string, Waiting>();

  constructor(store: Store, registry: SessionRegistry) {
    this.#store = store;
    this.#registry = registry;
    store.subscribe((change) => {
      if (change.type === "connector") this.#connected(change.connector);
    });
  }

  tool() {
    return defineTool({
      name: "request_app",
      description:
        "Ask the user for an app you need, such as Notion or GitHub, and say why. It returns " +
        "at once; once the user gives it to you, you are told by message and use it through " +
        "use_app_tool.",
      input: z.object({ app: z.string().trim().min(1).max(60), reason: z.string().trim().min(1) }),
      offeredTo: (caller) => this.#store.getAgent(caller.agentId)?.guest !== true,
      call: ({ app, reason }, caller) => this.#request(caller, app, reason),
    });
  }

  #request(caller: Caller, app: string, reason: string): string {
    const agent = this.#store.getAgent(caller.agentId);
    if (agent === undefined) throw new ToolError("No such agent.");
    const session = this.#store.getSession(caller.sessionId);
    const connector = appFor(this.#store, session, app);
    const wanted = app.toLowerCase();
    const entry = catalog.find(
      ({ setup }) => setup.slug === wanted || setup.name.toLowerCase() === wanted,
    );
    const setup = connector?.setup ?? entry?.setup;
    const name = setup?.name ?? app;
    const claude = claudeOnly(connector, entry);
    if (claude && (session === undefined || !hasVendorApps(session.options.harness))) {
      return this.#elsewhere(caller, agent, name, reason);
    }
    if (connector !== undefined && mayUse(connector, agent) && connector.status === "connected") {
      if (!claude) return `You already have ${name}. See its tools with list_app_tools.`;
      return connector.setup.app !== undefined &&
        (session?.options.vendorApps ?? []).includes(connector.setup.app)
        ? `You already have ${name}; use its own tools.`
        : `${name} came after this conversation began, so it is yours from your next task.`;
    }
    const requestId = `app-request-${randomUUID()}`;
    // A Claude app that is signed out is connected again, not given.
    const give =
      connector !== undefined && (!isClaudeApp(connector) || connector.status === "connected");
    this.#registry.ask(
      caller.sessionId,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title: `${agent.name} wants to use ${name}. ${reason}`,
          input: { app: name, reason },
          kind: "other",
          tool: { server: setup?.slug ?? slugOf(app), name: "request" },
          options: [
            give
              ? { optionId: "give", label: "Give access", kind: "allow_once" }
              : connector?.status === "signed_out"
                ? { optionId: "sign-in", label: `Sign in to ${name}`, kind: "allow_once" }
                : { optionId: "connect", label: `Connect ${name}`, kind: "allow_once" },
            { optionId: "decline", label: "Decline", kind: "reject_once" },
          ],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
        // The card's button opens the connect sheet; the core answers once the app is connected.
        if (command.optionId === "connect" || command.optionId === "sign-in") {
          throw new AnswerError(`Connect ${name} from its card.`);
        }
        const allowed = command.optionId !== "decline";
        this.#connecting.delete(requestId);
        return {
          resolution: {
            type: "permission.resolved",
            payload: {
              requestId,
              outcome: allowed ? "allowed" : "denied",
              optionId: command.optionId,
              answeredBy: "user",
            },
          },
          afterwards: () => this.#answered(caller.sessionId, agent.id, name, allowed),
        };
      },
    );
    if (!give) {
      const names = [wanted, name.toLowerCase(), ...(setup === undefined ? [] : [setup.slug])];
      this.#connecting.set(requestId, {
        sessionId: caller.sessionId,
        requestId,
        agentId: agent.id,
        names,
      });
    }
    return `Your request for ${name} is with the user. Their answer will reach you as a message.`;
  }

  async #answered(sessionId: string, agentId: string, name: string, allowed: boolean) {
    const tell = (text: string, summary: string) =>
      this.#registry.tell(sessionId, { text, origin: { kind: "notice", summary } });
    if (!allowed) {
      await tell(`The user did not give you ${name}.`, `You declined ${name}`);
      return;
    }
    const connector = appFor(this.#store, this.#store.getSession(sessionId), name);
    const agent = this.#store.getAgent(agentId);
    if (connector === undefined || agent === undefined) return;
    this.#store.updateConnector(connector.id, { audience: withAsker(connector.audience, agent) });
    const ready = isClaudeApp(connector)
      ? `${connector.setup.name} is ready for you from your next task; this conversation's apps stay as they are.`
      : `${connector.setup.name} is ready for you. See its tools with list_app_tools and call them with use_app_tool.`;
    await tell(ready, `You gave it ${connector.setup.name}`);
  }

  // Only Claude agents reach a Claude app: a teammate who has it takes the step, or the user is
  // told the team has no one who can.
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
    const only = `${name} is a Claude app, which only Claude agents use.`;
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
          title: `${agent.name} wants to use ${name}, which only Claude agents use. Add a Claude agent to the team for it. ${reason}`,
          input: { app: name, reason },
          kind: "other",
          tool: { server: slugOf(name), name: "request" },
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
          afterwards: () => this.#answered(caller.sessionId, agent.id, name, false),
        };
      },
    );
    return `${only} No one on your team can use it, and the user was told. Carry on without it.`;
  }

  // The user connected the app an agent asked for, so its ask is answered.
  #connected(connector: ConnectorRecord): void {
    if (connector.status !== "connected") return;
    const names = [connector.setup.slug, connector.setup.name.toLowerCase()];
    for (const waiting of this.#connecting.values()) {
      if (!waiting.names.some((name) => names.includes(name))) continue;
      if (!this.#registry.isRunning(waiting.sessionId)) {
        this.#connecting.delete(waiting.requestId);
        continue;
      }
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
