import type {
  Account,
  ConnectorRecord,
  ConnectorStatus,
  SessionEvent,
  SessionRecord,
  VendorApp,
} from "@office-town/contract";
import {
  hasVendorApps,
  listHarnesses,
  listVendorApps,
  vendorAppSignInPage,
} from "@office-town/harness";
import { allAccounts, hasSignIn, sessionAccountId } from "../accounts/accounts.ts";
import type { AppVerdict, SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { decide, isRead, mayUse } from "./access.ts";
import { ConnectError } from "./links.ts";

type PermissionRequest = Extract<SessionEvent, { type: "permission.requested" }>["payload"];

const STATUS: Record<VendorApp["status"], ConnectorStatus> = {
  connected: "connected",
  needs_sign_in: "signed_out",
  failed: "failing",
};

// "claude.ai Google Drive" is shown as "Google Drive".
const shownName = (app: string) => app.replace(/^claude\.ai /, "");

function slugBase(app: string): string {
  const words = shownName(app)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return `claude-${words}`.slice(0, 21).replace(/-$/, "");
}

// The user's claude.ai connectors, one record per app and Claude account. Office Town signs in to
// none of them and holds no token: Claude Code connects them, and only Claude agents use them
// (D-68). The core keeps who may use each and its permission, and decides every call.
export class ClaudeApps {
  readonly #store: Store;
  // Calls held for the user, by session and request id, to log once answered.
  readonly #asked = new Map<string, string>();
  readonly #stop = new AbortController();
  // One listing at a time; a refresh asked for meanwhile shares it.
  #refreshing: Promise<void> | undefined;

  constructor(store: Store, registry: SessionRegistry) {
    this.#store = store;
    registry.subscribe(({ event }) => {
      if (event.type !== "permission.resolved") return;
      const key = `${event.sessionId}/${event.payload.requestId}`;
      const callId = this.#asked.get(key);
      if (callId === undefined) return;
      this.#asked.delete(key);
      this.#store.endConnectorCall(
        callId,
        event.payload.outcome === "allowed" ? "done" : "refused",
      );
    });
  }

  refresh(): Promise<void> {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  // Stops a listing under way, so the core can close.
  close(): void {
    this.#stop.abort();
  }

  // Reads every signed-in Claude account's apps again; an account that cannot answer keeps its own.
  async #refresh(): Promise<void> {
    const accounts = allAccounts(this.#store, listHarnesses()).filter(
      (account) => hasVendorApps(account.harness) && hasSignIn(account),
    );
    await Promise.all(
      accounts.map(async (account) => {
        try {
          const { signal } = this.#stop;
          const apps = await listVendorApps(
            account.harness,
            account.environment,
            account.folder,
            signal,
          );
          if (!signal.aborted) this.#sync(account, apps);
        } catch (error) {
          if (this.#stop.signal.aborted) return;
          console.error(`Could not list the Claude apps of ${account.name}.`, error);
        }
      }),
    );
  }

  // Claude's page where the user signs the app in; it works from the agent's next conversation.
  async signInPage(id: string): Promise<string> {
    const connector = this.#store.getConnector(id);
    if (connector === undefined) throw new RecordNotFoundError("connector", id);
    const { account: accountId, app, name } = connector.setup;
    const account = allAccounts(this.#store, listHarnesses()).find(({ id }) => id === accountId);
    if (account === undefined || app === undefined)
      throw new ConnectError(name, "its account is gone");
    try {
      return await vendorAppSignInPage(account.harness, account.environment, account.folder, app);
    } catch (error) {
      throw new ConnectError(name, error);
    }
  }

  // A call to a Claude app: no access or a change under Read only is refused, a read or a Don't
  // ask call goes ahead, and an Ask me first change waits for the user. Logged either way.
  decide(session: SessionRecord, request: PermissionRequest): AppVerdict | undefined {
    const connector = this.#of(session, request);
    if (connector === undefined || request.tool === undefined) return undefined;
    const { name } = request.tool;
    const tool = this.#store.connectorTools(connector.id).find((known) => known.name === name);
    const change = tool === undefined || !isRead(tool);
    const record = (outcome: "done" | "refused" | "asked") =>
      this.#store.recordConnectorCall({
        connectorId: connector.id,
        sessionId: session.id,
        tool: name,
        input: request.input,
        change,
        outcome,
      });
    const agent = this.#store.getAgent(session.agentId);
    const app = connector.setup.name;
    if (agent === undefined || !mayUse(connector, agent)) {
      record("refused");
      return {
        allow: false,
        reason: connector.enabled ? `You do not have access to ${app}.` : `${app} is turned off.`,
      };
    }
    const decision = decide(connector.permission, !change);
    if (decision === "refuse") {
      record("refused");
      return { allow: false, reason: `${app} is read only for you, and ${name} changes things.` };
    }
    if (decision === "go") {
      record("done");
      return { allow: true };
    }
    this.#asked.set(`${session.id}/${request.requestId}`, record("asked").id);
    return undefined;
  }

  #of(session: SessionRecord, request: PermissionRequest): ConnectorRecord | undefined {
    const server = request.tool?.server;
    if (server === undefined || !(session.options.vendorApps ?? []).includes(server)) {
      return undefined;
    }
    const accountId = sessionAccountId(session.options);
    return this.#store
      .listConnectors()
      .find(
        ({ setup }) =>
          setup.kind === "claude" && setup.account === accountId && setup.app === server,
      );
  }

  // A new app gets Everyone and Ask me first; one gone from claude.ai goes with its settings.
  #sync(account: Account, apps: VendorApp[]): void {
    const known = this.#store
      .listConnectors()
      .filter(({ setup }) => setup.kind === "claude" && setup.account === account.id);
    for (const app of apps) {
      const tools = app.tools.map(({ name, description, readOnly }) => ({
        name,
        ...(description === undefined ? {} : { description }),
        inputSchema: {},
        annotations: { readOnlyHint: readOnly },
      }));
      const status = STATUS[app.status];
      const existing = known.find(({ setup }) => setup.app === app.name);
      if (existing === undefined) {
        this.#store.createConnector({
          setup: {
            slug: this.#freeSlug(app.name),
            name: shownName(app.name),
            kind: "claude",
            maker: "Claude",
            official: true,
            account: account.id,
            app: app.name,
            auth: "none",
            keys: [],
          },
          audience: { everyone: true, departmentIds: [], agentIds: [] },
          permission: "ask",
          status,
          tools,
        });
        continue;
      }
      // Tools are read only once connected, so a signed-out app keeps the ones it had.
      if (tools.length > 0) this.#store.saveConnectorTools(existing.id, tools);
      if (existing.enabled && existing.status !== status) {
        this.#store.updateConnector(existing.id, { status });
      }
    }
    // An empty list may be a fetch that did not finish, so it removes nothing.
    if (apps.length === 0) return;
    for (const gone of known.filter(({ setup }) => !apps.some(({ name }) => name === setup.app))) {
      this.#store.deleteConnector(gone.id);
    }
  }

  #freeSlug(app: string): string {
    const taken = new Set(this.#store.listConnectors().map(({ setup }) => setup.slug));
    const base = slugBase(app);
    for (let count = 1; ; count += 1) {
      const slug = count === 1 ? base : `${base}-${count}`;
      if (!taken.has(slug)) return slug;
    }
  }
}
