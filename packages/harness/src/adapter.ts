import type {
  AdapterCapabilities,
  HarnessCatalog,
  PermissionOption,
  Question,
  SessionEventBody,
  SessionOptions,
} from "@office-town/contract";

type BodyOf<T extends SessionEventBody["type"]> = Extract<SessionEventBody, { type: T }>;

// Turn ids and session end belong to the session, so an adapter reports turns without ids
// and never reports the session ending.
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

// A tool server as the harness reaches it from where it runs: directly, or through a command.
export type AttachedToolServer =
  | { transport: "http"; name: string; url: string; headers: Record<string, string> }
  | {
      transport: "stdio";
      name: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    };

// What a session gets for one launch only and never stores: tokens last one launch.
export interface LaunchExtras {
  toolServers?: ToolServer[];
}

// What an adapter is given: the session options with the workspace, additional folders and tool
// servers already resolved to what the harness sees where it runs.
export type LaunchOptions = SessionOptions & {
  workspacePath: string;
  toolServers: AttachedToolServer[];
};

// The server and tool an action calls, when the harness names it by one of the attached servers
// with a prefix of its own, such as "mcp__office-town__" or "office-town_".
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

export interface Translator {
  open(): string[];
  receive(line: string): Translation;
  prompt(text: string): Translation;
  answerPermission(requestId: string, option: PermissionOption): Translation;
  answerQuestion(requestId: string, answers: AnsweredQuestion[]): Translation;
  interrupt(): Translation;
}

// How to ask a harness what it offers: a command that runs to its end once its input is closed,
// and a pure reading of what it printed.
export interface CatalogQuery {
  command: HarnessCommand;
  input: string[];
  parse(output: string[]): HarnessCatalog;
}

export interface Adapter {
  readonly harness: string;
  // The harness's name as people know it.
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  // What still loads in an isolated session, when isolation is partial.
  readonly isolationNote?: string;
  readonly catalog?: CatalogQuery;
  buildCommand(options: LaunchOptions): HarnessCommand;
  createTranslator(options: LaunchOptions): Translator;
}
