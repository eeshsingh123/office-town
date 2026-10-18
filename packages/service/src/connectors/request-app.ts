import { randomUUID } from "node:crypto";
import type { AgentRecord, Audience, ConnectorRecord } from "@office-town/contract";
import { z } from "zod";
import { AnswerError, type SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { mayUse, reaches } from "./access.ts";
import { catalog } from "./catalog.ts";
import { findConnector } from "./gateway.ts";

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

// An agent without an app asks for it; the user connects it or gives access from Needs you,
// and the agent then reaches it through use_app_tool, so its tool list stays as it was (D-67).
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
    const connector = findConnector(this.#store, app);
    if (connector !== undefined && mayUse(connector, agent)) {
      return `You already have ${connector.setup.name}. See its tools with list_app_tools.`;
    }
    const wanted = app.toLowerCase();
    const entry = catalog.find(
      ({ setup }) => setup.slug === wanted || setup.name.toLowerCase() === wanted,
    );
    const setup = connector?.setup ?? entry?.setup;
    const name = setup?.name ?? app;
    const requestId = `app-request-${randomUUID()}`;
    const give = connector !== undefined;
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
              : { optionId: "connect", label: `Connect ${name}`, kind: "allow_once" },
            { optionId: "decline", label: "Decline", kind: "reject_once" },
          ],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
        // The card's button opens the connect sheet; the core answers once the app is connected.
        if (command.optionId === "connect") {
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
    const connector = findConnector(this.#store, name);
    const agent = this.#store.getAgent(agentId);
    if (connector === undefined || agent === undefined) return;
    this.#store.updateConnector(connector.id, { audience: withAsker(connector.audience, agent) });
    await tell(
      `${connector.setup.name} is ready for you. See its tools with list_app_tools and call them with use_app_tool.`,
      `You gave it ${connector.setup.name}`,
    );
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
