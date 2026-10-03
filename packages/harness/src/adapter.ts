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

// What an adapter is given: the session options with the workspace and additional folders already
// resolved to paths inside the environment the harness runs in.
export type LaunchOptions = SessionOptions & { workspacePath: string };

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
  readonly capabilities: AdapterCapabilities;
  readonly catalog?: CatalogQuery;
  buildCommand(options: LaunchOptions): HarnessCommand;
  createTranslator(options: LaunchOptions): Translator;
}
