import {
  type EnvironmentSpec,
  type HarnessCatalog,
  harnessCatalogSchema,
} from "@office-town/contract";
import { api } from "./client.ts";
import { loadLastKnown, saveLastKnown } from "./last-known.ts";

export const environmentKey = (environment: EnvironmentSpec) =>
  environment.kind === "wsl" ? `wsl:${environment.distro}` : "native";

const catalogKey = (harness: string, environment: EnvironmentSpec) =>
  `${harness}|${environmentKey(environment)}`;

const SAVED_NAME = "catalogs";

const parseCatalogs = (stored: unknown) =>
  new Map(
    Object.entries(stored as Record<string, unknown>).flatMap(([key, value]) => {
      const catalog = harnessCatalogSchema.safeParse(value);
      return catalog.success ? [[key, catalog.data] as const] : [];
    }),
  );

const saved = loadLastKnown(SAVED_NAME, parseCatalogs) ?? new Map<string, HarnessCatalog>();

function save(key: string, catalog: HarnessCatalog) {
  saved.set(key, catalog);
  saveLastKnown(SAVED_NAME, Object.fromEntries(saved));
}

// The list from the last read, even one from an earlier launch: shown at once, as a new read
// takes up to 9 seconds, and replaced when that read ends.
export const lastCatalog = (harness: string, environment: EnvironmentSpec) =>
  saved.get(catalogKey(harness, environment));

// Catalogs come from running the harness's CLI, which takes seconds, so each is read once.
const catalogs = new Map<string, Promise<HarnessCatalog>>();

export function readCatalog(
  harness: string,
  environment: EnvironmentSpec,
): Promise<HarnessCatalog> {
  const key = catalogKey(harness, environment);
  const cached = catalogs.get(key);
  if (cached !== undefined) return cached;
  const reading = api.readCatalog(harness, environment);
  catalogs.set(key, reading);
  reading.then(
    (catalog) => save(key, catalog),
    () => catalogs.delete(key),
  );
  return reading;
}
