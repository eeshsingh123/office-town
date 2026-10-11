import {
  type AccountStatus,
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
import { runProcess } from "./process-runner.ts";
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

export function describeHarness(harness: string, input: EnvironmentSpec): Promise<HarnessCatalog> {
  return readCatalog(findAdapter(harness), environmentFor(environmentSpecSchema.parse(input)));
}

export function runCommand(
  spec: EnvironmentSpec,
  command: { binary: string; args: string[]; cwd?: string },
): Promise<CommandResult> {
  return runIn(environmentFor(environmentSpecSchema.parse(spec)), command);
}

// Such as /mnt/c/work for C:\work in WSL.
export function environmentPath(spec: EnvironmentSpec, hostPath: string): string {
  return environmentFor(spec).toEnvironmentPath(hostPath);
}

// An account's sign-in, run where its agents run; `code` passes on the code a sign-in page shows.
export interface AccountSignIn {
  exited: Promise<number | null>;
  sendCode(code: string): void;
  stop(): Promise<void>;
}

// Undefined where the harness signs in some other way, such as OpenCode with a key.
export async function startAccountSignIn(
  harness: string,
  spec: EnvironmentSpec,
  folder: string,
  onLine: (line: string) => void,
): Promise<AccountSignIn | undefined> {
  const { accounts } = findAdapter(harness);
  if (accounts?.login === undefined) return undefined;
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  const exited = Promise.withResolvers<number | null>();
  const running = await runProcess(
    environment,
    {
      ...accounts.login,
      env: { ...accounts.login.env, ...accounts.env(environment.toEnvironmentPath(folder)) },
    },
    { onLine, onExit: (exit) => exited.resolve(exit.code) },
  );
  return {
    exited: exited.promise,
    sendCode: (code) => running.writeLine(code),
    stop: () => running.killTree(),
  };
}

// Hands a key to the harness's own sign-in, which saves it (D-6); true once it says it is done.
export async function saveAccountKey(
  harness: string,
  spec: EnvironmentSpec,
  folder: string,
  provider: string,
  key: string,
): Promise<boolean> {
  const { accounts } = findAdapter(harness);
  if (accounts?.keyLogin === undefined) return false;
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  const command = accounts.keyLogin(provider);
  const exited = Promise.withResolvers<number | null>();
  const running = await runProcess(
    environment,
    { ...command, env: { ...command.env, ...accounts.env(environment.toEnvironmentPath(folder)) } },
    { onLine: () => {}, onExit: (exit) => exited.resolve(exit.code) },
  );
  // Its prompt takes Enter as a carriage return, as a terminal sends it.
  running.writeLine(`${key}\r`);
  const timer = setTimeout(() => void running.killTree(), 30_000);
  const code = await exited.promise;
  clearTimeout(timer);
  return code === 0;
}

// Where an account's sign-in is saved inside its folder, for a harness that keeps accounts apart.
export function accountCredentials(harness: string): string | undefined {
  return findAdapter(harness).accounts?.credentials;
}

// Who is signed in on an account; undefined where the harness cannot say.
export async function readAccountStatus(
  harness: string,
  spec: EnvironmentSpec,
  folder: string | undefined,
): Promise<AccountStatus | undefined> {
  const { accounts } = findAdapter(harness);
  if (accounts?.status === undefined) return undefined;
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  const { command, parse } = accounts.status;
  const env = {
    ...command.env,
    ...(folder === undefined ? {} : accounts.env(environment.toEnvironmentPath(folder))),
  };
  const result = await runIn(environment, { ...command, env });
  return parse(result.stdout);
}
