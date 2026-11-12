import {
  type ConnectorAction,
  type ConnectorChange,
  type ConnectorRecord,
  type ConnectorSetup,
  type ConnectorTestRequest,
  type NewConnectorRequest,
  providerOf,
} from "@office-town/contract";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { actionsOf, isProviderApp } from "./access.ts";
import { ConnectorGateway } from "./gateway.ts";
import { ConnectError, ConnectorLinks, probe } from "./links.ts";
import { ProviderApps } from "./provider-apps.ts";
import { AppRequests } from "./request-app.ts";
import { type Secrets, writeKeys } from "./secrets.ts";

// The core keeps one link per key app and program, which every harness reaches (D-67). Provider
// apps are the provider's own: the hub only keeps their settings (D-68, D-96).
export class ConnectorHub {
  readonly links: ConnectorLinks;
  readonly gateway: ConnectorGateway;
  readonly providerApps: ProviderApps;
  readonly asks: AppRequests;
  readonly #store: Store;
  readonly #secrets: Secrets;

  // carryOn lets an agent hand over to a new conversation that has an app just given (D-96).
  constructor(
    store: Store,
    registry: SessionRegistry,
    secrets: Secrets,
    carryOn?: (sessionId: string) => void,
  ) {
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
    this.providerApps = new ProviderApps(store, registry);
    this.asks = new AppRequests(store, registry, carryOn);
  }

  get secretsKind(): Secrets["kind"] {
    return this.#secrets.kind;
  }

  async test({ setup, keys = {} }: ConnectorTestRequest): Promise<ConnectorAction[]> {
    return actionsOf(await this.#probe(setup, keys));
  }

  // Tried before it is saved. Provider apps come only from the provider's own list.
  async create({ setup, audience, permission, keys = {} }: NewConnectorRequest) {
    if (providerOf(setup.kind) !== undefined) {
      throw new ConnectError(setup.name, "set it up through its provider, then check again");
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
      if (isProviderApp(before))
        throw new ConnectError(before.setup.name, "its provider keeps its sign-in");
      await this.#probe(before.setup, keys);
      writeKeys(this.#secrets, id, keys);
      await this.links.drop(id);
    }
    const turnedOff = enabled === false && before.enabled;
    const turnedOn = enabled === true && !before.enabled;
    if (turnedOff) await this.links.drop(id);
    // A provider app's status is the provider's, read on the next refresh.
    const provider = isProviderApp(before);
    const connector = this.#store.updateConnector(id, {
      ...(audience === undefined ? {} : { audience }),
      ...(permission === undefined ? {} : { permission }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(turnedOff ? { status: "off" as const } : {}),
      ...(turnedOn || keys !== undefined ? { status: "connected" as const } : {}),
    });
    // The link reports how it really stands.
    if (!provider && (turnedOn || keys !== undefined)) this.#refreshLater(connector);
    return connector;
  }

  // A provider app is removed in its provider; here it can only be turned off.
  async remove(id: string): Promise<void> {
    const connector = this.#require(id);
    if (isProviderApp(connector)) {
      throw new ConnectError(
        connector.setup.name,
        "remove it in its provider, or turn it off here",
      );
    }
    await this.links.drop(id);
    this.#secrets.remove(id);
    this.#store.deleteConnector(id);
  }

  async close(): Promise<void> {
    this.providerApps.close();
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
    if (connector === undefined) throw new RecordNotFoundError("connector");
    return connector;
  }
}
