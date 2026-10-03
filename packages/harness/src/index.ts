import {
  type AdapterCapabilities,
  type EnvironmentSpec,
  environmentSpecSchema,
  type HarnessCatalog,
  type SessionOptions,
  sessionOptionsSchema,
} from "@office-town/contract";
import { adapters, findAdapter } from "./adapters/registry.ts";
import { readCatalog } from "./catalog.ts";
import type { Environment } from "./environment/environment.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { WslEnvironment } from "./environment/wsl.ts";
import { HarnessSession, type Session } from "./session.ts";

export { UnknownHarnessError } from "./adapters/registry.ts";
export { CatalogError } from "./catalog.ts";
export { BinaryNotFoundError } from "./environment/find-binary.ts";
export {
  type HarnessLine,
  type LineListener,
  type Session,
  type SessionListener,
  SessionStateError,
} from "./session.ts";

function environmentFor(environment: EnvironmentSpec): Environment {
  switch (environment.kind) {
    case "native":
      return new NativeEnvironment();
    case "wsl":
      return new WslEnvironment(environment.distro);
  }
}

export function createSession(input: SessionOptions): Session {
  const options = sessionOptionsSchema.parse(input);
  return new HarnessSession(
    options,
    findAdapter(options.harness),
    environmentFor(options.environment),
  );
}

export interface HarnessDescription {
  harness: string;
  capabilities: AdapterCapabilities;
}

export function listHarnesses(): HarnessDescription[] {
  return adapters.map(({ harness, capabilities }) => ({ harness, capabilities }));
}

// The models a harness offers in an environment, with the effort values each one accepts.
export function describeHarness(harness: string, input: EnvironmentSpec): Promise<HarnessCatalog> {
  return readCatalog(findAdapter(harness), environmentFor(environmentSpecSchema.parse(input)));
}
