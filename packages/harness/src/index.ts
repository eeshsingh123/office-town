import { type SessionOptions, sessionOptionsSchema } from "@office-town/contract";
import { adapters, findAdapter } from "./adapters/registry.ts";
import type { Environment } from "./environment/environment.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { HarnessSession, type Session } from "./session.ts";

export { UnknownHarnessError } from "./adapters/registry.ts";
export { BinaryNotFoundError } from "./environment/find-binary.ts";
export { type Session, type SessionListener, SessionStateError } from "./session.ts";

function environmentFor(options: SessionOptions): Environment {
  if (options.environment.kind === "native") return new NativeEnvironment();
  throw new Error(`The "${options.environment.kind}" environment is not available yet.`);
}

export function createSession(input: SessionOptions): Session {
  const options = sessionOptionsSchema.parse(input);
  return new HarnessSession(options, findAdapter(options.harness), environmentFor(options));
}

export function listHarnesses(): string[] {
  return adapters.map((adapter) => adapter.harness);
}
