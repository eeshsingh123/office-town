import {
  type EnvironmentSpec,
  environmentSpecSchema,
  type HarnessCatalog,
  type HarnessDescription,
  type SessionOptions,
  sessionOptionsSchema,
} from "@office-town/contract";
import type { LaunchExtras } from "./adapter.ts";
import { adapters, findAdapter } from "./adapters/registry.ts";
import { readCatalog } from "./catalog.ts";
import { type CommandResult, runIn } from "./command.ts";
import type { Environment } from "./environment/environment.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { listDistros, WslEnvironment } from "./environment/wsl.ts";
import { HarnessSession, type Session } from "./session.ts";

export type { LaunchExtras, ToolServer } from "./adapter.ts";
export { UnknownHarnessError } from "./adapters/registry.ts";
export { CatalogError } from "./catalog.ts";
export type { CommandResult } from "./command.ts";
export { BinaryNotFoundError } from "./environment/find-binary.ts";
export {
  type CoreReport,
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

export function createSession(input: SessionOptions, extras: LaunchExtras = {}): Session {
  const options = sessionOptionsSchema.parse(input);
  return new HarnessSession(
    options,
    findAdapter(options.harness),
    environmentFor(options.environment),
    extras,
  );
}

export function listHarnesses(): HarnessDescription[] {
  return adapters.map(({ harness, name, capabilities, isolationNote }) => ({
    harness,
    name,
    capabilities,
    ...(isolationNote === undefined ? {} : { isolationNote }),
  }));
}

export async function listEnvironments(): Promise<EnvironmentSpec[]> {
  const distros = await listDistros();
  return [{ kind: "native" }, ...distros.map((distro) => ({ kind: "wsl" as const, distro }))];
}

// The models a harness offers in an environment, with the effort values each one accepts.
export function describeHarness(harness: string, input: EnvironmentSpec): Promise<HarnessCatalog> {
  return readCatalog(findAdapter(harness), environmentFor(environmentSpecSchema.parse(input)));
}

// Runs a command to its end where a harness would run, with paths as that environment sees them.
export function runCommand(
  spec: EnvironmentSpec,
  command: { binary: string; args: string[]; cwd?: string },
): Promise<CommandResult> {
  return runIn(environmentFor(environmentSpecSchema.parse(spec)), command);
}

// A host path as a harness in that environment sees it, such as /mnt/c/work for C:work in WSL.
export function environmentPath(spec: EnvironmentSpec, hostPath: string): string {
  return environmentFor(spec).toEnvironmentPath(hostPath);
}
