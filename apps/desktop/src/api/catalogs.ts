import type { EnvironmentSpec, HarnessCatalog } from "@office-town/contract";
import { api } from "./client.ts";

export const environmentKey = (environment: EnvironmentSpec) =>
  environment.kind === "wsl" ? `wsl:${environment.distro}` : "native";

// Catalogs come from running the harness's CLI, which takes seconds, so each is read once.
const catalogs = new Map<string, Promise<HarnessCatalog>>();

export function readCatalog(
  harness: string,
  environment: EnvironmentSpec,
): Promise<HarnessCatalog> {
  const key = `${harness}|${environmentKey(environment)}`;
  const cached = catalogs.get(key);
  if (cached !== undefined) return cached;
  const reading = api.readCatalog(harness, environment);
  catalogs.set(key, reading);
  reading.catch(() => catalogs.delete(key));
  return reading;
}
