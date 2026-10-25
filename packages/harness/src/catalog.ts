import { type HarnessCatalog, harnessCatalogSchema } from "@office-town/contract";
import type { Adapter } from "./adapter.ts";
import type { Environment } from "./environment/environment.ts";
import { QueryError, runQuery } from "./query.ts";

const CATALOG_TIMEOUT_MS = 60_000;

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export async function readCatalog(
  adapter: Adapter,
  environment: Environment,
): Promise<HarnessCatalog> {
  const query = adapter.catalog;
  if (query === undefined) {
    throw new CatalogError(`The "${adapter.harness}" harness cannot list its models.`);
  }
  const catalog = await runQuery(environment, query, { timeoutMs: CATALOG_TIMEOUT_MS }).catch(
    (error: unknown) => {
      if (!(error instanceof QueryError)) throw error;
      throw new CatalogError(
        `The "${adapter.harness}" harness did not list its models. ${error.message}`,
      );
    },
  );
  return harnessCatalogSchema.parse(catalog);
}
