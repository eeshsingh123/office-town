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

// For a harness that prefixes server names, such as "mcp__office-town__" or "office-town_". The
// longest server name is tried first, so "office-town-apps" is never read as "office-town".
export function attachedTool(
  title: string,
  servers: readonly { name: string }[],
  prefixOf: (server: string) => string | string[],
): { server: string; name: string } | undefined {
  const longestFirst = servers.toSorted((a, b) => b.name.length - a.name.length);
  for (const { name: server } of longestFirst) {
    for (const prefix of [prefixOf(server)].flat()) {
      if (title.startsWith(prefix) && title.length > prefix.length) {
        return { server, name: title.slice(prefix.length) };
      }
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

// One question asked by running the CLI: `input` is written once it starts and `read` finds the
// answer in its output. A CLI that answers and exits is read once it ends; a `server`, which stays
// up until its input closes, is read line by line and stopped once it has answered.
export interface HarnessQuery<T> {
  command: HarnessCommand;
  input?: string[];
  server?: boolean;
  // Undefined while the output does not hold the answer yet. Once the CLI has ended, the end of
  // what it wrote to stderr comes too.
  read(output: string[], stderr?: string): T | undefined;
}

export type CatalogQuery = HarnessQuery<HarnessCatalog>;

// How a harness keeps several logins apart, each in a folder of its own (D-61).
export interface AccountSupport {
  // Variables that point the CLI at an account's folder, as the harness's environment sees it.
  env(folder: string): Record<string, string>;
  // The file in the folder that holds the sign-in, once there is one; unset where the CLI may keep
  // it in the system's credential store, so the app remembers the sign-ins it saw finish.
  credentials?: string;
  // Signs in, printing a page to open and reading a code from stdin if the page shows one.
  login?: HarnessCommand;
  // Signs in with a key from the provider's console, written to stdin as `input` gives it; the CLI
  // saves it.
  keyLogin?: (provider: string) => { command: HarnessCommand; input(key: string): string };
  status?: HarnessQuery<AccountStatus>;
  // The default login's folder, inside the home folder.
  home?: string;
  // Asks the vendor for the plan usage now, with the sign-in file's text; undefined if it cannot.
  readLimits?: (credentials: string) => Promise<UsageLimit[] | undefined>;
  // Or asks the CLI itself, for one that reports it.
  limits?: HarnessQuery<UsageLimit[]>;
}

// One way the vendor installs its CLI, run as is (D-6, D-75).
export interface Installer {
  // A program it cannot run without; the first installer whose program is here runs. `named` is
  // what the user installs to get it, such as Node.js for npm.
  needs: string;
  named?: string;
  command: HarnessCommand;
}

// How a user gets the CLI, in the vendor's own words, for setup.
export interface InstallSupport {
  // Exits 0 when the CLI is installed.
  version: HarnessCommand;
  // What setup shows the user to run, and the vendor's page.
  windows: string;
  unix: string;
  page: string;
  installers: { windows: Installer[]; unix: Installer[] };
  // Where the installers put the CLI, under the home folder. Their PATH change reaches only new
  // terminals, so the app adds these folders itself.
  folders?: string[];
}

// Apps the vendor connects for a login itself, such as the user's claude.ai connectors (D-68) or
// Codex's ChatGPT apps (D-96). Listing them never changes anything.
export interface VendorAppSupport {
  // Run on the login, it answers without starting a turn.
  command: HarnessCommand;
  // Written once at start, then `poll` every so often until the list is in. A CLI that prints its
  // list and exits has neither and is read once it ends.
  start?: string[];
  poll?: string;
  // With none allowed, every app is turned off without a list, so none is read at start.
  allOff?: boolean;
  // Its ask before an app's call does not say what the call sends, so a new app starts on Don't
  // ask rather than on Ask me first (D-96, D-98).
  asksWithoutInput?: boolean;
  // Undefined for any other line, or for a CLI that exits, for an output that has no list yet. An
  // app still connecting is listed as failed, with `pending`.
  read(output: string[]): { apps: VendorApp[]; pending: boolean } | undefined;
  // Prints the vendor's page where the user signs an app in, and exits.
  signIn?(app: string): HarnessCommand;
  signInPage?(output: string[]): string | undefined;
  // Adds an app the login does not have yet, by its name, and answers the vendor's page where the
  // user signs it in; the vendor keeps the sign-in.
  setUp?(app: string): HarnessQuery<string>;
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
  // For the Providers page, in the user's words (D-76).
  readonly maker: string;
  readonly summary: string;
  readonly needs: string;
  readonly capabilities: AdapterCapabilities;
  // The models.dev providers that list its models' API prices, tried in order (D-76).
  readonly priceLists?: string[];
  // The vendor's page with the plan usage, for an app that shares none with other apps.
  readonly usagePage?: string;
  // What still loads in an isolated session, when isolation is partial.
  readonly isolationNote?: string;
  readonly catalog?: CatalogQuery;
  readonly accounts?: AccountSupport;
  readonly install?: InstallSupport;
  readonly vendorApps?: VendorAppSupport;
  readonly recount?: RecountSupport;
  // For a CLI whose major releases differ in their commands: the adapter for the version installed
  // where it runs (D-97). Sessions start the same way on every version.
  forVersion?(version: string): Adapter;
  buildCommand(options: LaunchOptions): HarnessCommand;
  createTranslator(options: LaunchOptions): Translator;
}
