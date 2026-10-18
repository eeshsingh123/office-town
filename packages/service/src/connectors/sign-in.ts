import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Secrets } from "./secrets.ts";

// What the credential store keeps for one connector.
export interface ConnectorSecret {
  keys?: Record<string, string>;
  tokens?: OAuthTokens;
  client?: OAuthClientInformationMixed;
  // The address the client was registered with; the core's port can change between runs.
  redirectUrl?: string;
}

export function readSecret(secrets: Secrets, id: string): ConnectorSecret {
  const text = secrets.read(id);
  return text === undefined ? {} : (JSON.parse(text) as ConnectorSecret);
}

export function writeSecret(secrets: Secrets, id: string, change: ConnectorSecret): void {
  secrets.write(id, JSON.stringify({ ...readSecret(secrets, id), ...change }));
}

// The SDK registers the app, refreshes tokens and runs PKCE; this only keeps what it hands over.
// Without `redirect`, a call that needs the user's sign-in fails instead of opening a page.
export class SignInProvider implements OAuthClientProvider {
  readonly #secrets: Secrets;
  readonly #id: string;
  readonly #redirectUrl: string | undefined;
  readonly #state = randomBytes(24).toString("base64url");
  #verifier = "";
  pageUrl: URL | undefined;

  constructor(secrets: Secrets, id: string, redirectUrl?: string) {
    this.#secrets = secrets;
    this.#id = id;
    this.#redirectUrl = redirectUrl;
  }

  get redirectUrl(): string | undefined {
    return this.#redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Office Town",
      redirect_uris: this.#redirectUrl === undefined ? [] : [this.#redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.#state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const { client, redirectUrl } = readSecret(this.#secrets, this.#id);
    // A client registered for another port cannot finish a new sign-in, so it registers again.
    if (this.#redirectUrl !== undefined && redirectUrl !== this.#redirectUrl) return undefined;
    return client;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    writeSecret(this.#secrets, this.#id, {
      client,
      ...(this.#redirectUrl === undefined ? {} : { redirectUrl: this.#redirectUrl }),
    });
  }

  tokens(): OAuthTokens | undefined {
    return readSecret(this.#secrets, this.#id).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    writeSecret(this.#secrets, this.#id, { tokens });
  }

  redirectToAuthorization(url: URL): void {
    this.pageUrl = url;
  }

  saveCodeVerifier(verifier: string): void {
    this.#verifier = verifier;
  }

  codeVerifier(): string {
    return this.#verifier;
  }

  // A pasted key is the user's, so it survives whatever the app throws away.
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    const { keys, tokens, client, redirectUrl } = readSecret(this.#secrets, this.#id);
    const dropTokens = scope === "all" || scope === "tokens";
    const dropClient = scope === "all" || scope === "client";
    const kept: ConnectorSecret = {
      ...(keys === undefined ? {} : { keys }),
      ...(dropTokens || tokens === undefined ? {} : { tokens }),
      ...(dropClient || client === undefined
        ? {}
        : { client, ...(redirectUrl === undefined ? {} : { redirectUrl }) }),
    };
    this.#secrets.write(this.#id, JSON.stringify(kept));
  }
}

// Sign-ins started and not yet finished, by their one-time state.
export class SignIns {
  readonly #secrets: Secrets;
  readonly #waiting = new Map<
    string,
    { connectorId: string; url: string; provider: SignInProvider }
  >();

  constructor(secrets: Secrets) {
    this.#secrets = secrets;
  }

  // The app's own sign-in page.
  async begin(connectorId: string, url: string, redirectUrl: string): Promise<URL> {
    const provider = new SignInProvider(this.#secrets, connectorId, redirectUrl);
    await auth(provider, { serverUrl: url });
    if (provider.pageUrl === undefined) throw new Error("The app did not ask for a sign-in.");
    this.#waiting.set(provider.state(), { connectorId, url, provider });
    return provider.pageUrl;
  }

  // Returns the connector signed in to, or undefined for a state that was never handed out.
  async finish(state: string, code: string): Promise<string | undefined> {
    const waiting = this.#waiting.get(state);
    if (waiting === undefined) return undefined;
    this.#waiting.delete(state);
    await auth(waiting.provider, { serverUrl: waiting.url, authorizationCode: code });
    return waiting.connectorId;
  }
}
