import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AccountStatus,
  type EnvironmentSpec,
  environmentSpecSchema,
  type HarnessCatalog,
  type HarnessDescription,
  type HarnessStatus,
  type SessionOptions,
  sessionOptionsSchema,
  type TokenUsage,
  type UsageLimit,
  type VendorApp,
} from "@office-town/contract";
import type { Adapter, LaunchExtras } from "./adapter.ts";
import { adapters, findAdapter } from "./adapters/registry.ts";
import { readCatalog } from "./catalog.ts";
import { type CommandResult, runIn } from "./command.ts";
import type { Environment } from "./environment/environment.ts";
import { NativeEnvironment } from "./environment/native.ts";
import { listDistros, WslEnvironment } from "./environment/wsl.ts";
import { installerHere } from "./install.ts";
import { runProcess } from "./process-runner.ts";
import { runQuery } from "./query.ts";
import { HarnessSession, type Session } from "./session.ts";
import { readSignInPage, readVendorApps } from "./vendor-apps.ts";

export type { LaunchExtras, ToolServer } from "./adapter.ts";
export { UnknownHarnessError } from "./adapters/registry.ts";
export { CatalogError } from "./catalog.ts";
export type { CommandResult } from "./command.ts";
export { BinaryNotFoundError } from "./environment/find-binary.ts";
export {
  addInstallFoldersToPath,
  type InstallExit,
  type RunningInstall,
  startHarnessInstall,
} from "./install.ts";
export {
  type CoreReport,
  type HarnessLine,
  type LineListener,
  type Session,
  type SessionListener,
  SessionStateError,
} from "./session.ts";
export { VendorAppsError } from "./vendor-apps.ts";

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

function signInOf({ accounts }: Adapter): HarnessDescription["signIn"] {
  if (accounts?.login !== undefined) return "browser";
  return accounts?.keyLogin === undefined ? "none" : "key";
}

export function listHarnesses(): HarnessDescription[] {
  return adapters.map((adapter) => {
    const { harness, name, maker, summary, needs, capabilities, isolationNote } = adapter;
    return {
      harness,
      name,
      maker,
      summary,
      needs,
      capabilities,
      ...(isolationNote === undefined ? {} : { isolationNote }),
      signIn: signInOf(adapter),
      manyAccounts: adapter.accounts !== undefined,
    };
  });
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

// OpenCode names each model's provider in its id, so it needs no list of its own.
export function priceLists(harness: string): string[] {
  return findAdapter(harness).priceLists ?? [];
}

export function canRecount(harness: string): boolean {
  return findAdapter(harness).recount !== undefined;
}

// What a conversation and its sub-agents really used, from the harness's own records; undefined
// where the harness keeps none or they cannot be read.
export async function recountUsage(
  harness: string,
  spec: EnvironmentSpec,
  accountFolder: string | undefined,
  conversationId: string,
): Promise<TokenUsage | undefined> {
  const { recount, accounts } = findAdapter(harness);
  if (recount === undefined) return undefined;
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  const env =
    accountFolder === undefined || accounts === undefined
      ? {}
      : accounts.env(environment.toEnvironmentPath(accountFolder));
  const total = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const queue = [conversationId];
  const seen = new Set<string>();
  // A cap, in case sub-agents ever name each other.
  for (let id = queue.shift(); id !== undefined && seen.size < 50; id = queue.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const command = recount.command(id);
    const result = await runIn(environment, { ...command, env: { ...command.env, ...env } });
    if (result.code !== 0) return undefined;
    const { usage, children } = recount.parse(result.stdout);
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.cachedInputTokens += usage.cachedInputTokens ?? 0;
    queue.push(...children);
  }
  return total;
}

// Such as /mnt/c/work for C:\work in WSL.
export function environmentPath(spec: EnvironmentSpec, hostPath: string): string {
  return environmentFor(spec).toEnvironmentPath(hostPath);
}

// Such as C:\work for /mnt/c/work in WSL.
export function hostPath(spec: EnvironmentSpec, environmentPath: string): string {
  return environmentFor(spec).toHostPath(environmentPath);
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
  // Unset signs in the CLI's own default login.
  folder: string | undefined,
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
      env: {
        ...accounts.login.env,
        ...(folder === undefined ? {} : accounts.env(environment.toEnvironmentPath(folder))),
      },
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

// Whether the harness connects apps of its own for a login, such as Claude apps (D-68).
export function hasVendorApps(harness: string): boolean {
  return findAdapter(harness).vendorApps !== undefined;
}

function loginEnv(harness: string, environment: Environment, folder: string | undefined) {
  const { accounts } = findAdapter(harness);
  if (folder === undefined || accounts === undefined) return {};
  return accounts.env(environment.toEnvironmentPath(folder));
}

// A login's apps once they have connected, or as far as they got in 20 seconds.
export function listVendorApps(
  harness: string,
  spec: EnvironmentSpec,
  folder: string | undefined,
  signal?: AbortSignal,
): Promise<VendorApp[]> {
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  return readVendorApps(findAdapter(harness), environment, loginEnv(harness, environment, folder), {
    settled: true,
    timeoutMs: 20_000,
    ...(signal === undefined ? {} : { signal }),
  });
}

// The vendor's page where the user signs one app in; the harness keeps the sign-in.
export function vendorAppSignInPage(
  harness: string,
  spec: EnvironmentSpec,
  folder: string | undefined,
  app: string,
): Promise<string> {
  const support = findAdapter(harness).vendorApps;
  if (support === undefined) throw new Error(`The "${harness}" harness has no apps of its own.`);
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  const command = support.signIn(app);
  return readSignInPage(
    environment,
    { ...command, env: { ...command.env, ...loginEnv(harness, environment, folder) } },
    support.signInPage,
  );
}

// Where an account's sign-in is saved inside its folder, for a harness that keeps accounts apart.
export function accountCredentials(harness: string): string | undefined {
  return findAdapter(harness).accounts?.credentials;
}

// Such as "1.4.13" from "Muse Code 1.4.13 (1.4.13-R6996.1)" or "2026.10.22-27dcf5f".
const VERSION = /\d+(?:\.\d+)+(?:-[\w.]+)?/;

// The CLI's version, or undefined when it is not installed here.
async function readVersion(environment: Environment, install: Adapter["install"]) {
  if (install === undefined) return "";
  const result = await runIn(environment, install.version).catch(() => undefined);
  if (result?.code !== 0) return undefined;
  return VERSION.exec(result.stdout)?.[0] ?? "";
}

// Whether the CLI is on this computer and signed in, with how to install it if not.
export async function readHarnessStatus(harness: string): Promise<HarnessStatus> {
  const { install } = findAdapter(harness);
  const environment = environmentFor({ kind: "native" });
  // At once: the first two each start the CLI, which takes most of a second.
  const [version, signIn, installer] = await Promise.all([
    readVersion(environment, install),
    readAccountStatus(harness, { kind: "native" }, undefined).catch(() => undefined),
    installerHere(install),
  ]);
  const installed = version !== undefined;
  const status = installed ? signIn : undefined;
  return {
    harness,
    installed,
    ...(version ? { version } : {}),
    canInstall: installer.found !== undefined,
    ...(installer.found === undefined ? {} : { installWith: installer.found.needs }),
    ...(installer.missing === undefined ? {} : { installNeeds: installer.missing }),
    ...(status === undefined ? {} : { signedIn: status.signedIn }),
    ...(install === undefined
      ? {}
      : {
          installCommand: process.platform === "win32" ? install.windows : install.unix,
          installPage: install.page,
        }),
  };
}

const STATUS_TIMEOUT_MS = 30_000;

// Who is signed in on an account; undefined where the harness cannot say.
export async function readAccountStatus(
  harness: string,
  spec: EnvironmentSpec,
  folder: string | undefined,
): Promise<AccountStatus | undefined> {
  const { accounts } = findAdapter(harness);
  if (accounts?.status === undefined) return undefined;
  const environment = environmentFor(environmentSpecSchema.parse(spec));
  return runQuery(environment, accounts.status, {
    env: loginEnv(harness, environment, folder),
    timeoutMs: STATUS_TIMEOUT_MS,
  });
}

// The plan usage as the vendor has it now, for a harness that can say; undefined otherwise.
export async function readAccountLimits(
  harness: string,
  spec: EnvironmentSpec,
  folder: string | undefined,
): Promise<UsageLimit[] | undefined> {
  const { accounts } = findAdapter(harness);
  const environment = environmentSpecSchema.parse(spec);
  if (accounts?.limits !== undefined) {
    const where = environmentFor(environment);
    return runQuery(where, accounts.limits, {
      env: loginEnv(harness, where, folder),
      timeoutMs: STATUS_TIMEOUT_MS,
    }).catch(() => undefined);
  }
  if (accounts?.readLimits === undefined || accounts.credentials === undefined) return undefined;
  const { credentials, home } = accounts;
  let text: string | undefined;
  if (folder !== undefined) {
    // An added account's folder is in the data folder, on this machine.
    text = await readFile(join(folder, credentials), "utf8").catch(() => undefined);
  } else if (home === undefined) {
    return undefined;
  } else if (environment.kind === "native") {
    text = await readFile(join(homedir(), home, credentials), "utf8").catch(() => undefined);
  } else {
    const path = `"$HOME"/${home}/${credentials}`;
    const result = await runIn(environmentFor(environment), {
      binary: "sh",
      args: ["-c", `cat ${path}`],
    }).catch(() => undefined);
    text = result?.code === 0 ? result.stdout : undefined;
  }
  return text === undefined ? undefined : accounts.readLimits(text).catch(() => undefined);
}
