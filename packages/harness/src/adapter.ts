import type {
  AccountStatus,
  AdapterCapabilities,
  HarnessCatalog,
  PermissionOption,
  Question,
  SessionEventBody,
  SessionOptions,
  TokenUsage,
  UsageLimit,
  VendorApp,
} from "@office-town/contract";

type BodyOf<T extends SessionEventBody["type"]> = Extract<SessionEventBody, { type: T }>;

// Turn ids and the session's end belong to the session, so adapters report neither.
export type AdapterEvent =
  | Exclude<SessionEventBody, { type: "session.ended" | "turn.started" | "turn.ended" }>
  | { type: "turn.started" }
  | { type: "turn.ended"; payload: Omit<BodyOf<"turn.ended">["payload"], "turnId"> };

// An MCP server the core serves, and the token that names the session calling it.
export interface ToolServer {
  name: string;
  url: string;
  token: string;
}

// `token` is the one its headers or env carry, so an adapter can keep it off a command line.
export type AttachedToolServer = { name: string; token: string } & (
  | { transport: "http"; url: string; headers: Record<string, string> }
  | { transport: "stdio"; command: string; args: string[]; env: Record<string, string> }
);

// Tokens last one launch and are never stored.
export interface LaunchExtras {
  toolServers?: ToolServer[];
}

// Workspace, folders and tool servers already resolved to what the harness sees where it runs.
export type LaunchOptions = SessionOptions & {
  workspacePath: string;
  toolServers: AttachedToolServer[];
  // The login's other vendor apps, found at launch, which the session must not reach.
  blockedApps?: string[];
};

// For a harness that prefixes server names, such as "mcp__office-town__" or "office-town_".
export function attachedTool(
  title: string,
  servers: readonly { name: string }[],
  prefixOf: (server: string) => string,
): { server: string; name: string } | undefined {
  for (const { name: server } of servers) {
    const prefix = prefixOf(server);
    if (title.startsWith(prefix) && title.length > prefix.length) {
      return { server, name: title.slice(prefix.length) };
    }
  }
  return undefined;
}

export interface HarnessCommand {
  binary: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AnsweredQuestion {
  question: Question;
  selected: string[];
}

export interface Translation {
  events: AdapterEvent[];
  outgoing: string[];
  // The line only carried a fragment of text that a later event reports whole.
  partial?: boolean;
}

// Base64, for a harness whose protocol carries images (`capabilities.images`).
export interface InlineImage {
  mimeType: string;
  data: string;
}

export interface Translator {
  open(): string[];
  receive(line: string): Translation;
  prompt(text: string, images: InlineImage[]): Translation;
  answerPermission(requestId: string, option: PermissionOption): Translation;
  answerQuestion(requestId: string, answers: AnsweredQuestion[]): Translation;
  interrupt(): Translation;
}

// A command that runs to its end once its input closes, and a pure reading of its output.
export interface CatalogQuery {
  command: HarnessCommand;
  input: string[];
  parse(output: string[]): HarnessCatalog;
}

// How a harness keeps several logins apart, each in a folder of its own (D-61).
export interface AccountSupport {
  // Variables that point the CLI at an account's folder, as the harness's environment sees it.
  env(folder: string): Record<string, string>;
  // The file in the folder that holds the sign-in, once there is one.
  credentials: string;
  // Signs in, printing a page to open and reading a code from stdin if the page shows one.
  login?: HarnessCommand;
  // Signs in with a key from the provider's console, read from stdin; the CLI saves it.
  keyLogin?: (provider: string) => HarnessCommand;
  status?: { command: HarnessCommand; parse(output: string): AccountStatus };
  // The default login's folder, inside the home folder.
  home?: string;
  // Asks the vendor for the plan usage now, with the sign-in file's text; undefined if it cannot.
  readLimits?: (credentials: string) => Promise<UsageLimit[] | undefined>;
}

// How a user gets the CLI, in the vendor's own words, for setup.
export interface InstallSupport {
  // Exits 0 when the CLI is installed.
  version: HarnessCommand;
  windows: string;
  unix: string;
  page: string;
}

// Apps the vendor connects for a login itself, such as the user's claude.ai connectors (D-68).
export interface VendorAppSupport {
  // Run on the login, it answers without starting a turn.
  command: HarnessCommand;
  // Written once at start, then `poll` every so often until the list is in.
  start: string[];
  poll: string;
  // Undefined for any other line. An app still connecting is listed as failed, with `pending`.
  read(line: string): { apps: VendorApp[]; pending: boolean } | undefined;
  // Prints the vendor's page where the user signs an app in, and exits.
  signIn(app: string): HarnessCommand;
  signInPage(output: string[]): string | undefined;
}

// Reads what a conversation really used from the harness's own records, after its session ends.
export interface RecountSupport {
  command(conversationId: string): HarnessCommand;
  // Its tokens, and the conversations its sub-agents ran in, which are read the same way.
  parse(output: string): { usage: TokenUsage; children: string[] };
}

export interface Adapter {
  readonly harness: string;
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  // What still loads in an isolated session, when isolation is partial.
  readonly isolationNote?: string;
  readonly catalog?: CatalogQuery;
  readonly accounts?: AccountSupport;
  readonly install?: InstallSupport;
  readonly vendorApps?: VendorAppSupport;
  readonly recount?: RecountSupport;
  buildCommand(options: LaunchOptions): HarnessCommand;
  createTranslator(options: LaunchOptions): Translator;
}
