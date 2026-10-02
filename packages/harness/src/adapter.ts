import type {
  AdapterCapabilities,
  PermissionOption,
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

export interface HarnessCommand {
  binary: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Translation {
  events: AdapterEvent[];
  outgoing: string[];
}

export interface Translator {
  open(): string[];
  receive(line: string): Translation;
  prompt(text: string): string[];
  answerPermission(requestId: string, option: PermissionOption): string[];
  interrupt(): string[];
}

export interface Adapter {
  readonly harness: string;
  readonly capabilities: AdapterCapabilities;
  buildCommand(options: SessionOptions): HarnessCommand;
  createTranslator(options: SessionOptions): Translator;
}
