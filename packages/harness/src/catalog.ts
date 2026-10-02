import { setTimeout as delay } from "node:timers/promises";
import { type HarnessCatalog, harnessCatalogSchema } from "@office-town/contract";
import type { Adapter } from "./adapter.ts";
import type { Environment, ProcessExit } from "./environment/environment.ts";
import { runProcess } from "./process-runner.ts";

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
  const output: string[] = [];
  const exited = Promise.withResolvers<{ exit: ProcessExit; stderrTail: string }>();
  const running = await runProcess(environment, query.command, {
    onLine: (line) => output.push(line),
    onExit: (exit, stderrTail) => exited.resolve({ exit, stderrTail }),
  });
  for (const line of query.input) running.writeLine(line);
  running.closeInput();

  const finished = await Promise.race([
    exited.promise,
    delay(CATALOG_TIMEOUT_MS, undefined, { ref: false }),
  ]);
  if (finished === undefined) {
    await running.killTree();
    throw new CatalogError(`The "${adapter.harness}" harness did not list its models in time.`);
  }
  if (finished.exit.code !== 0) {
    const detail = finished.stderrTail.trim();
    throw new CatalogError(
      `The "${adapter.harness}" harness failed to list its models${detail === "" ? "." : `: ${detail}`}`,
    );
  }
  return harnessCatalogSchema.parse(query.parse(output));
}
