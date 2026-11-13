import type { EnvironmentSpec } from "@office-town/contract";
import type { Adapter } from "./adapter.ts";
import { runIn } from "./command.ts";
import type { Environment } from "./environment/environment.ts";
import { inQueryTurn } from "./query.ts";

// Such as "1.4.13" from "Muse Code 1.4.13 (1.4.13-R6996.1)" or "2026.10.22-27dcf5f".
const VERSION = /\d+(?:\.\d+)+(?:-[\w.]+)?/;

// The CLI's version, or undefined when it is not installed here. Read in a query turn, except
// for a session starting, which never waits (D-92).
export async function readVersion(
  environment: Environment,
  install: Adapter["install"],
  queued = true,
): Promise<string | undefined> {
  if (install === undefined) return "";
  const read = () => runIn(environment, install.version);
  const result = await (queued ? inQueryTurn(read) : read()).catch(() => undefined);
  if (result?.code !== 0) return undefined;
  return VERSION.exec(result.stdout)?.[0] ?? "";
}

// The version found where each CLI runs, kept from every status read so the commands that differ
// between its major releases pick the right ones without asking again (D-97).
const found = new Map<string, string>();

const keyOf = (harness: string, spec: EnvironmentSpec) =>
  spec.kind === "native" ? harness : `${harness} wsl:${spec.distro}`;

export function rememberVersion(
  harness: string,
  spec: EnvironmentSpec,
  version: string | undefined,
): void {
  if (version === undefined) found.delete(keyOf(harness, spec));
  else found.set(keyOf(harness, spec), version);
}

// A command that failed may have met a CLI upgraded since, so the next one reads it again.
export function forgetVersion(harness: string, spec: EnvironmentSpec): void {
  found.delete(keyOf(harness, spec));
}

// The adapter for the version installed where it runs; the adapter itself when its releases
// do not differ, or when it is not installed there.
export async function installedAdapter(
  adapter: Adapter,
  spec: EnvironmentSpec,
  environment: Environment,
  queued = true,
): Promise<Adapter> {
  if (adapter.forVersion === undefined) return adapter;
  const key = keyOf(adapter.harness, spec);
  let version = found.get(key);
  if (version === undefined) {
    version = await readVersion(environment, adapter.install, queued);
    rememberVersion(adapter.harness, spec, version);
  }
  return version === undefined ? adapter : adapter.forVersion(version);
}
