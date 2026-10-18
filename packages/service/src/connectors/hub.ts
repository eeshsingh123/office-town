import type {
  ConnectorChange,
  ConnectorRecord,
  ConnectorSetup,
  ConnectorTestRequest,
  NewConnectorRequest,
} from "@office-town/contract";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { isClaudeApp } from "./access.ts";
import { ClaudeApps } from "./claude-apps.ts";
import { ConnectorGateway } from "./gateway.ts";
import { ConnectError, ConnectorLinks, probe } from "./links.ts";
import { type Secrets, writeKeys } from "./secrets.ts";

// The core keeps one link per key app and program, which every harness reaches (D-67). Claude
// apps are Claude Code's own: the hub only keeps their settings (D-68).
export class ConnectorHub {
  readonly links: ConnectorLinks;
  readonly gateway: ConnectorGateway;
  readonly claudeApps: ClaudeApps;
  readonly #store: Store;
  readonly #secrets: Secrets;

  constructor(store: Store, registry: SessionRegistry, secrets: Secrets) {
    this.#store = store;
    this.#secrets = secrets;
    this.links = new ConnectorLinks(secrets, {
      tools: (id, tools) => {
        if (store.getConnector(id) !== undefined) store.saveConnectorTools(id, tools);
      },
      // A connector the user turned off stays off.
      status: (id, status) => {
        const connector = store.getConnector(id);
        if (connector === undefined || !connector.enabled || connector.status === status) return;
        store.updateConnector(id, { status });
      },
    });
    this.gateway = new ConnectorGateway(store, registry, this.links);
    this.claudeApps = new ClaudeApps(store, registry);
  }

  get secretsKind(): Secrets["kind"] {
    return this.#secrets.kind;
  }

  async test({ setup, keys = {} }: ConnectorTestRequest): Promise<number> {
    return (await this.#probe(setup, keys)).length;
  }

  // Tried before it is saved. Claude apps come only from Claude Code's own list.
  async create({ setup, audience, permission, keys = {} }: NewConnectorRequest) {
    if (setup.kind === "claude") {
      throw new ConnectError(setup.name, "connect it in Claude, then refresh");
    }
    const tools = await this.#probe(setup, keys);
    const connector = this.#store.createConnector({
      setup,
      audience,
      permission,
      status: "connected",
      tools,
    });
    if (Object.keys(keys).length > 0) writeKeys(this.#secrets, connector.id, keys);
    return connector;
  }

  async change(id: string, { audience, permission, enabled, keys }: ConnectorChange) {
    const before = this.#require(id);
    if (keys !== undefined) {
      if (isClaudeApp(before))
        throw new ConnectError(before.setup.name, "Claude keeps its sign-in");
      await this.#probe(before.setup, keys);
      writeKeys(this.#secrets, id, keys);
      await this.links.drop(id);
    }
    const turnedOff = enabled === false && before.enabled;
    const turnedOn = enabled === true && !before.enabled;
    if (turnedOff) await this.links.drop(id);
    // A Claude app's status is Claude Code's, read on the next refresh.
    const claude = isClaudeApp(before);
    const connector = this.#store.updateConnector(id, {
      ...(audience === undefined ? {} : { audience }),
      ...(permission === undefined ? {} : { permission }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(turnedOff ? { status: "off" as const } : {}),
      ...(turnedOn || keys !== undefined ? { status: "connected" as const } : {}),
    });
    // The link reports how it really stands.
    if (!claude && (turnedOn || keys !== undefined)) this.#refreshLater(connector);
    return connector;
  }

  // A Claude app is removed in Claude; here it can only be turned off.
  async remove(id: string): Promise<void> {
    const connector = this.#require(id);
    if (isClaudeApp(connector)) {
      throw new ConnectError(connector.setup.name, "remove it in Claude, or turn it off here");
    }
    await this.links.drop(id);
    this.#secrets.remove(id);
    this.#store.deleteConnector(id);
  }

  async close(): Promise<void> {
    this.claudeApps.close();
    await this.links.close();
  }

  async #probe(setup: ConnectorSetup, keys: Record<string, string>) {
    try {
      return await probe(setup, keys);
    } catch (error) {
      throw new ConnectError(setup.name, error);
    }
  }

  #refreshLater(connector: ConnectorRecord): void {
    this.links.refresh(connector).catch((error: unknown) => {
      console.error(`Connector ${connector.setup.name} did not connect.`, error);
    });
  }

  #require(id: string): ConnectorRecord {
    const connector = this.#store.getConnector(id);
    if (connector === undefined) throw new RecordNotFoundError("connector", id);
    return connector;
  }
}
