import type {
  ConnectorChange,
  ConnectorRecord,
  ConnectorSetup,
  ConnectorTestRequest,
  NewConnectorRequest,
} from "@office-town/contract";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { ConnectorGateway } from "./gateway.ts";
import { ConnectorLinks, probe } from "./links.ts";
import type { Secrets } from "./secrets.ts";
import { SignIns, writeSecret } from "./sign-in.ts";

// A connection that failed before saving, or a sign-in that could not start.
export class ConnectError extends Error {
  constructor(name: string, error: unknown) {
    super(
      `Could not connect to ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    this.name = "ConnectError";
  }
}

// The core owns every connection: it signs in once and keeps one link per connector (D-67).
export class ConnectorHub {
  readonly links: ConnectorLinks;
  readonly gateway: ConnectorGateway;
  readonly #store: Store;
  readonly #secrets: Secrets;
  readonly #signIns: SignIns;
  #callbackUrl = "";

  constructor(store: Store, registry: SessionRegistry, secrets: Secrets) {
    this.#store = store;
    this.#secrets = secrets;
    this.#signIns = new SignIns(secrets);
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
  }

  get secretsKind(): Secrets["kind"] {
    return this.#secrets.kind;
  }

  // Sign-ins come back to the core's own API server.
  listenAt(apiUrl: string): void {
    this.#callbackUrl = `${apiUrl}/connectors/callback`;
  }

  async test({ setup, keys = {} }: ConnectorTestRequest): Promise<number> {
    return (await this.#probe(setup, keys)).length;
  }

  // A sign-in app is saved signed out, then signed in to; any other is tried first.
  async create({ setup, audience, permission, keys = {} }: NewConnectorRequest) {
    if (setup.auth === "sign-in") {
      return this.#store.createConnector({
        setup,
        audience,
        permission,
        status: "signed_out",
        tools: [],
      });
    }
    const tools = await this.#probe(setup, keys);
    const connector = this.#store.createConnector({
      setup,
      audience,
      permission,
      status: "connected",
      tools,
    });
    if (Object.keys(keys).length > 0) writeSecret(this.#secrets, connector.id, { keys });
    return connector;
  }

  async change(id: string, { audience, permission, enabled, keys }: ConnectorChange) {
    const before = this.#require(id);
    if (keys !== undefined) {
      await this.#probe(before.setup, keys);
      writeSecret(this.#secrets, id, { keys });
      await this.links.drop(id);
    }
    const turnedOff = enabled === false && before.enabled;
    const turnedOn = enabled === true && !before.enabled;
    if (turnedOff) await this.links.drop(id);
    const connector = this.#store.updateConnector(id, {
      ...(audience === undefined ? {} : { audience }),
      ...(permission === undefined ? {} : { permission }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(turnedOff ? { status: "off" as const } : {}),
      ...(turnedOn || keys !== undefined ? { status: "connected" as const } : {}),
    });
    // The link reports how it really stands.
    if (turnedOn || keys !== undefined) this.#refreshLater(connector);
    return connector;
  }

  async remove(id: string): Promise<void> {
    this.#require(id);
    await this.links.drop(id);
    this.#secrets.remove(id);
    this.#store.deleteConnector(id);
  }

  // The app's own page, to open in the system browser.
  async beginSignIn(id: string): Promise<URL> {
    const { setup } = this.#require(id);
    if (setup.auth !== "sign-in" || setup.url === undefined) {
      throw new ConnectError(setup.name, "it takes no sign-in");
    }
    try {
      return await this.#signIns.begin(id, setup.url, this.#callbackUrl);
    } catch (error) {
      throw new ConnectError(setup.name, error);
    }
  }

  // The app's name once signed in, or undefined for a page the core never opened.
  async finishSignIn(state: string, code: string): Promise<string | undefined> {
    const id = await this.#signIns.finish(state, code);
    if (id === undefined) return undefined;
    const connector = this.#require(id);
    await this.links.drop(id);
    await this.links.refresh(connector);
    this.gateway.signedIn(id);
    return connector.setup.name;
  }

  async close(): Promise<void> {
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
