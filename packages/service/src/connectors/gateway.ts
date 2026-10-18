import { randomUUID } from "node:crypto";
import type { ConnectorRecord } from "@office-town/contract";
import { z } from "zod";
import { PERMISSION_WORDS } from "../agents/briefs.ts";
import { AnswerError, type SessionRegistry } from "../registry/session-registry.ts";
import type { Store } from "../store/store.ts";
import { unknownTool } from "../tools/tool-server.ts";
import {
  type Caller,
  defineTool,
  type Endpoint,
  type Tool,
  ToolError,
  type ToolResult,
} from "../tools/tools.ts";
import { decide, isRead, mayUse, usableBy } from "./access.ts";
import type { ConnectorLinks } from "./links.ts";

const RESULT_CHARS = 20_000;
// Sent by the core alone, once the user signed in from the app's own page.
const SIGNED_IN = "signed-in";

const failed = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const said = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

// "create_page" reads as "Create page".
export function toolWords(name: string): string {
  const words = name.replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function textOf(result: ToolResult): string {
  const text = result.content
    .map((part) => {
      const { type, text } = part as { type?: string; text?: string };
      return type === "text" && text !== undefined ? text : `[${type ?? "content"}]`;
    })
    .join("\n");
  return text.length <= RESULT_CHARS ? text : `${text.slice(0, RESULT_CHARS)}\n[cut short]`;
}

// By slug or name, as an agent may write either.
export function findConnector(store: Store, app: string): ConnectorRecord | undefined {
  const wanted = app.trim().toLowerCase();
  return store
    .listConnectors()
    .find(({ setup }) => setup.slug === wanted || setup.name.toLowerCase() === wanted);
}

// Every connector call passes here, natively or through the hub: it is checked against who may
// use the app now and its permission, logged, and then forwarded, held for the user, or refused.
export class ConnectorGateway {
  readonly #store: Store;
  readonly #registry: SessionRegistry;
  readonly #links: ConnectorLinks;
  // One Sign in again ask per task and connector, by "<task>/<connector>".
  readonly #signInAsks = new Map<string, { sessionId: string; requestId: string }>();

  constructor(store: Store, registry: SessionRegistry, links: ConnectorLinks) {
    this.#store = store;
    this.#registry = registry;
    this.#links = links;
  }

  endpointOf(slug: string): Endpoint | undefined {
    const connector = findConnector(this.#store, slug);
    if (connector === undefined) return undefined;
    return {
      name: slug,
      list: () => this.#store.connectorTools(connector.id),
      call: async (name, input, caller) => {
        const current = this.#store.getConnector(connector.id);
        if (current === undefined) throw unknownTool(name);
        return this.use(caller, current, name, input);
      },
    };
  }

  hubTools(): Tool[] {
    return [this.#listAppTools(), this.#useAppTool()];
  }

  // The asks it raised for the connector are answered, and their agents told it is back.
  signedIn(connectorId: string): void {
    const name = this.#store.getConnector(connectorId)?.setup.name ?? "The app";
    for (const [key, ask] of this.#signInAsks) {
      if (!key.endsWith(`/${connectorId}`) || !this.#registry.isRunning(ask.sessionId)) continue;
      void this.#registry
        .send(ask.sessionId, {
          type: "answerPermission",
          requestId: ask.requestId,
          optionId: SIGNED_IN,
        })
        .then(() =>
          this.#registry.tell(ask.sessionId, {
            text: `${name} is signed in again. You can use it now.`,
            origin: { kind: "notice", summary: `${name} is signed in again` },
          }),
        )
        .catch((error: unknown) =>
          console.error(`Could not tell an agent ${name} is back.`, error),
        );
    }
  }

  async use(
    caller: Caller,
    connector: ConnectorRecord,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { setup } = connector;
    const tool = this.#store.connectorTools(connector.id).find((known) => known.name === name);
    if (tool === undefined) {
      return failed(`${setup.name} has no tool "${name}". See its tools with list_app_tools.`);
    }
    const change = !isRead(tool);
    const record = (outcome: "done" | "refused" | "failed" | "asked") =>
      this.#store.recordConnectorCall({
        connectorId: connector.id,
        sessionId: caller.sessionId,
        tool: name,
        input,
        change,
        outcome,
      });
    const agent = this.#store.getAgent(caller.agentId);
    if (agent === undefined || !mayUse(connector, agent)) {
      record("refused");
      return failed(
        connector.enabled
          ? `You do not have access to ${setup.name}. Ask for it with request_app.`
          : `${setup.name} is turned off.`,
      );
    }
    if (connector.status === "signed_out") {
      record("failed");
      return this.#signedOut(caller, connector);
    }
    const decision = decide(connector.permission, !change);
    if (decision === "refuse") {
      record("refused");
      return failed(`${setup.name} is read only for you, and ${name} changes things.`);
    }
    if (decision === "ask") {
      this.#hold(caller, connector, name, input, record("asked").id);
      return said(
        `This change in ${setup.name} waits for the user's OK. Its result will reach you as a message; carry on with other work or end your turn.`,
      );
    }
    const result = await this.#run(connector, name, input);
    record(result.isError === true ? "failed" : "done");
    if (this.#store.getConnector(connector.id)?.status === "signed_out") {
      return this.#signedOut(caller, connector);
    }
    return result;
  }

  async #run(connector: ConnectorRecord, name: string, input: Record<string, unknown>) {
    try {
      return await this.#links.call(connector, name, input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failed(`${connector.setup.name} could not do it: ${reason}`);
    }
  }

  // Ask me first: the user sees what it will do, and the core makes the call once approved.
  #hold(
    caller: Caller,
    connector: ConnectorRecord,
    name: string,
    input: Record<string, unknown>,
    callId: string,
  ): void {
    const { setup } = connector;
    const requestId = `app-${randomUUID()}`;
    const title = `${toolWords(name)} in ${setup.name}`;
    const tell = (text: string, summary: string) =>
      this.#registry.tell(caller.sessionId, { text, origin: { kind: "notice", summary } });
    this.#registry.ask(
      caller.sessionId,
      {
        type: "permission.requested",
        payload: {
          requestId,
          title,
          input,
          kind: "other",
          tool: { server: setup.slug, name },
          options: [
            { optionId: "approve", label: "Approve", kind: "allow_once" },
            { optionId: "decline", label: "Decline", kind: "reject_once" },
          ],
        },
      },
      (command) => {
        if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
        const approved = command.optionId === "approve";
        return {
          resolution: {
            type: "permission.resolved",
            payload: {
              requestId,
              outcome: approved ? "allowed" : "denied",
              optionId: command.optionId,
              answeredBy: "user",
            },
          },
          afterwards: async () => {
            if (!approved) {
              this.#store.endConnectorCall(callId, "refused");
              await tell(`The user declined: ${title}.`, `You declined: ${title}`);
              return;
            }
            const result = await this.#run(connector, name, input);
            this.#store.endConnectorCall(callId, result.isError === true ? "failed" : "done");
            const outcome = result.isError === true ? "It failed" : "Result";
            await tell(
              `The user approved: ${title}. ${outcome}:\n${textOf(result)}`,
              `You approved: ${title}`,
            );
          },
        };
      },
    );
  }

  #signedOut(caller: Caller, connector: ConnectorRecord): ToolResult {
    const { setup } = connector;
    const key = `${caller.taskId}/${connector.id}`;
    const waiting = this.#signInAsks.get(key);
    if (waiting === undefined || !this.#registry.isRunning(waiting.sessionId)) {
      const requestId = `sign-in-${randomUUID()}`;
      this.#signInAsks.set(key, { sessionId: caller.sessionId, requestId });
      this.#registry.ask(
        caller.sessionId,
        {
          type: "permission.requested",
          payload: {
            requestId,
            title: `Sign in to ${setup.name} again`,
            input: {},
            kind: "other",
            tool: { server: setup.slug, name: "sign-in" },
            options: [
              { optionId: "sign-in", label: "Sign in again", kind: "allow_once" },
              { optionId: "not-now", label: "Not now", kind: "reject_once" },
            ],
          },
        },
        (command) => {
          if (command.type !== "answerPermission") throw new AnswerError("This is a sign-in.");
          // The card's button opens the app's page; the core answers once the sign-in is done.
          if (command.optionId === "sign-in") {
            throw new AnswerError(`Sign in to ${setup.name} from its card.`);
          }
          this.#signInAsks.delete(key);
          const signedIn = command.optionId === SIGNED_IN;
          return {
            resolution: {
              type: "permission.resolved",
              payload: {
                requestId,
                outcome: signedIn ? "allowed" : "denied",
                optionId: command.optionId,
                answeredBy: "user",
              },
            },
          };
        },
      );
    }
    return failed(
      `${setup.name} is signed out. The user was asked to sign in again; you will get a message once it is back.`,
    );
  }

  #listAppTools(): Tool {
    return defineTool({
      name: "list_app_tools",
      description:
        "Without app: the apps you can use now, with what you may do in each. With app: that " +
        "app's tools and their input schemas, to call with use_app_tool.",
      input: z.object({ app: z.string().min(1).optional() }),
      offeredTo: () => true,
      call: ({ app }, caller) => {
        const usable = usableBy(this.#store, caller.agentId);
        if (app === undefined) {
          if (usable.length === 0) return "You have no apps. Ask for one with request_app.";
          return usable
            .map(({ setup, permission, status }) => {
              const note = status === "signed_out" ? " Signed out for now." : "";
              return `- ${setup.name} (app: "${setup.slug}"): ${PERMISSION_WORDS[permission]}.${note}`;
            })
            .join("\n");
        }
        const connector = findConnector(this.#store, app);
        if (connector === undefined || !usable.some(({ id }) => id === connector.id)) {
          throw new ToolError(`You have no app called "${app}". See yours with list_app_tools.`);
        }
        const tools = this.#store.connectorTools(connector.id).map((tool) => ({
          name: tool.name,
          description: tool.description,
          changes: !isRead(tool),
          inputSchema: tool.inputSchema,
        }));
        return JSON.stringify(tools);
      },
    });
  }

  #useAppTool(): Tool {
    return defineTool({
      name: "use_app_tool",
      description:
        "Call a tool of one of your apps, as list_app_tools describes it. A change may wait " +
        "for the user's OK; its result then reaches you later as a message.",
      input: z.object({
        app: z.string().min(1),
        tool: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).default({}),
      }),
      offeredTo: () => true,
      call: ({ app, tool, arguments: given }, caller) => {
        const connector = findConnector(this.#store, app);
        if (connector === undefined) {
          throw new ToolError(`No app called "${app}". See yours with list_app_tools.`);
        }
        return this.use(caller, connector, tool, given);
      },
    });
  }
}
