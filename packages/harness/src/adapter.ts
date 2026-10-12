import type {
  AccountStatus,
  AdapterCapabilities,
  HarnessCatalog,
  PermissionOption,
  Question,
  SessionEventBody,
  SessionOptions,
  UsageLimit,
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

export interface Adapter {
  readonly harness: string;
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  // What still loads in an isolated session, when isolation is partial.
  readonly isolationNote?: string;
  readonly catalog?: CatalogQuery;
  readonly accounts?: AccountSupport;
  buildCommand(options: LaunchOptions): HarnessCommand;
  createTranslator(options: LaunchOptions): Translator;
}
