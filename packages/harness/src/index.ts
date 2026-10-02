import { type SessionOptions, sessionOptionsSchema } from "@office-town/contract";
import { adapters, findAdapter } from "./adapters/registry.ts";
import type { Environment } from "./environment/environment.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { WslEnvironment } from "./environment/wsl.ts";
import { HarnessSession, type Session } from "./session.ts";

export { UnknownHarnessError } from "./adapters/registry.ts";
export { BinaryNotFoundError } from "./environment/find-binary.ts";
export { type Session, type SessionListener, SessionStateError } from "./session.ts";

function environmentFor(options: SessionOptions): Environment {
  const { environment } = options;
  switch (environment.kind) {
    case "native":
      return new NativeEnvironment();
    case "wsl":
      return new WslEnvironment(environment.distro);
  }
}

export function createSession(input: SessionOptions): Session {
  const options = sessionOptionsSchema.parse(input);
  return new HarnessSession(options, findAdapter(options.harness), environmentFor(options));
}

export function listHarnesses(): string[] {
  return adapters.map((adapter) => adapter.harness);
}
