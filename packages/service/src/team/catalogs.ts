import type { EnvironmentSpec, HarnessCatalog } from "@office-town/contract";
import { describeHarness } from "@office-town/harness";

export type ReadCatalog = (
  harness: string,
  environment: EnvironmentSpec,
) => Promise<HarnessCatalog>;

const keyOf = (harness: string, environment: EnvironmentSpec) =>
  `${harness}|${environment.kind === "wsl" ? `wsl:${environment.distro}` : "native"}`;

// A catalog comes from running the harness's CLI, which takes seconds, so each is read once per
// launch of the core; a failed read is tried again next time.
export function cachedCatalogs(read: ReadCatalog = describeHarness): ReadCatalog {
  const catalogs = new Map<string, Promise<HarnessCatalog>>();
  return (harness, environment) => {
    const key = keyOf(harness, environment);
    const cached = catalogs.get(key);
    if (cached !== undefined) return cached;
    const reading = read(harness, environment);
    catalogs.set(key, reading);
    reading.catch(() => catalogs.delete(key));
    return reading;
  };
}
