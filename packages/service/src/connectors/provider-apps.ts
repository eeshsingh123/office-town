import type {
  Account,
  ConnectorKind,
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
  vendorAppSetUpPage,
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

// Each provider's kind of app, and who the user reads it comes from.
const KINDS: Record<string, { kind: ConnectorKind; maker: string }> = {
  claude: { kind: "claude", maker: "Claude" },
  codex: { kind: "codex", maker: "ChatGPT" },
  opencode: { kind: "opencode", maker: "OpenCode" },
};

// Where the user adds an app to Claude; Claude Code loads it for the login (D-68).
const CLAUDE_CONNECTORS = "https://claude.ai/customize/connectors";

// "claude.ai Google Drive" is shown as "Google Drive".
const shownName = (app: string) => app.replace(/^claude\.ai /, "");

function slugBase(harness: string, app: string): string {
  const words = shownName(app)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return `${harness}-${words}`.slice(0, 21).replace(/-$/, "");
}

// The provider apps of each login: the user's claude.ai connectors, Codex's ChatGPT apps and
// OpenCode's own servers, one record per app and account. Office Town signs in to none of them
// and holds no token: the provider connects them, and only its agents use them (D-68, D-96). The
// core keeps who may use each and its permission, and decides every call.
export class ProviderApps {
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

  // Reads every signed-in account's apps again; an account that cannot answer keeps its own.
  async #refresh(): Promise<void> {
    const accounts = allAccounts(this.#store, listHarnesses()).filter(
      (account) =>
        KINDS[account.harness] !== undefined &&
        hasVendorApps(account.harness) &&
        hasSignIn(account, this.#store),
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
          console.error(`Could not list the apps of ${account.name}.`, error);
        }
      }),
    );
  }

  // The provider's page where the user signs the app in again; it works from the agent's next
  // conversation.
  async signInPage(id: string): Promise<string> {
    const connector = this.#store.getConnector(id);
    if (connector === undefined) throw new RecordNotFoundError("connector");
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

  // The provider's page where the user adds an app it does not have yet, on its first signed-in
  // login; the provider keeps the sign-in and the app is read on the next refresh (D-96).
  async setUpPage(provider: string, app: string): Promise<string> {
    if (provider === "claude") return CLAUDE_CONNECTORS;
    const account = allAccounts(this.#store, listHarnesses()).find(
      (candidate) => candidate.harness === provider && hasSignIn(candidate, this.#store),
    );
    if (account === undefined) throw new ConnectError(app, `sign in to ${provider} first`);
    try {
      return await vendorAppSetUpPage(provider, account.environment, account.folder, app);
    } catch (error) {
      throw new ConnectError(app, error);
    }
  }

  // A call to a provider app: no access or a change under Read only is refused, a read or a Don't
  // ask call goes ahead, and an Ask me first change waits for the user. Logged either way. An
  // action not seen before, as OpenCode lists none, is kept for the app's page and counts as a
  // change.
  decide(session: SessionRecord, request: PermissionRequest): AppVerdict | undefined {
    const connector = this.#of(session, request);
    if (connector === undefined || request.tool === undefined) return undefined;
    const { name } = request.tool;
    const known = this.#store.connectorTools(connector.id);
    const tool = known.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      this.#store.saveConnectorTools(connector.id, [...known, { name, inputSchema: {} }]);
    }
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
    const kind = KINDS[session.options.harness]?.kind;
    return this.#store
      .listConnectors()
      .find(
        ({ setup }) => setup.kind === kind && setup.account === accountId && setup.app === server,
      );
  }

  // A new app gets Everyone and Ask me first; one gone from the provider goes with its settings.
  #sync(account: Account, apps: VendorApp[]): void {
    const own = KINDS[account.harness];
    if (own === undefined) return;
    const known = this.#store
      .listConnectors()
      .filter(({ setup }) => setup.kind === own.kind && setup.account === account.id);
    for (const app of apps) {
      // The provider's own name for it, which its settings and its calls use.
      const appId = app.id ?? app.name;
      const tools = app.tools.map(({ name, description, readOnly }) => ({
        name,
        ...(description === undefined ? {} : { description }),
        inputSchema: {},
        annotations: { readOnlyHint: readOnly },
      }));
      const status = STATUS[app.status];
      const existing = known.find(({ setup }) => setup.app === appId);
      if (existing === undefined) {
        this.#store.createConnector({
          setup: {
            slug: this.#freeSlug(account.harness, app.name),
            name: shownName(app.name),
            kind: own.kind,
            maker: own.maker,
            official: true,
            account: account.id,
            app: appId,
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
    const listed = new Set(apps.map(({ id, name }) => id ?? name));
    for (const gone of known.filter(({ setup }) => !listed.has(setup.app ?? ""))) {
      this.#store.deleteConnector(gone.id);
    }
  }

  #freeSlug(harness: string, app: string): string {
    const taken = new Set(this.#store.listConnectors().map(({ setup }) => setup.slug));
    const base = slugBase(harness, app);
    for (let count = 1; ; count += 1) {
      const slug = count === 1 ? base : `${base}-${count}`;
      if (!taken.has(slug)) return slug;
    }
  }
}
