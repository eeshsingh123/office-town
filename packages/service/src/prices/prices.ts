import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TokenUsage } from "@office-town/contract";
import { z } from "zod";

// The open price list OpenCode itself uses: US dollars per million tokens (D-76).
const SOURCE = "https://models.dev/api.json";
const FILE = "prices.json";

const sourceSchema = z.record(
  z.string(),
  z.looseObject({
    models: z.record(
      z.string(),
      z.looseObject({
        cost: z
          .looseObject({ input: z.number(), output: z.number(), cache_read: z.number().optional() })
          .optional(),
      }),
    ),
  }),
);

const priceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
});
type Price = z.infer<typeof priceSchema>;

// By provider, then model.
const tableSchema = z.record(z.string(), z.record(z.string(), priceSchema));
type Table = z.infer<typeof tableSchema>;

function trimmed(source: z.infer<typeof sourceSchema>): Table {
  return Object.fromEntries(
    Object.entries(source).map(([provider, { models }]) => [
      provider,
      Object.fromEntries(
        Object.entries(models).flatMap(([model, { cost }]) =>
          cost === undefined
            ? []
            : [
                [
                  model,
                  {
                    input: cost.input,
                    output: cost.output,
                    ...(cost.cache_read === undefined ? {} : { cacheRead: cost.cache_read }),
                  },
                ],
              ],
        ),
      ),
    ]),
  );
}

// Read once when the app opens and kept in the data folder, so an estimate works offline too.
export class PriceList {
  #table: Table = {};

  async load(dataFolder: string, fetchList: typeof fetch = fetch): Promise<void> {
    const file = join(dataFolder, FILE);
    const cached = await readFile(file, "utf8").then(
      (text) => tableSchema.parse(JSON.parse(text)),
      () => undefined,
    );
    if (cached !== undefined) this.#table = cached;
    const response = await fetchList(SOURCE, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`models.dev answered ${response.status}.`);
    this.#table = trimmed(sourceSchema.parse(await response.json()));
    await writeFile(file, JSON.stringify(this.#table));
  }

  // A model named "provider/model", as OpenCode names them, is looked up under its provider;
  // any other in the harness's own lists, in order.
  #priceOf(model: string, lists: string[]): Price | undefined {
    const slash = model.indexOf("/");
    if (slash > 0) return this.#table[model.slice(0, slash)]?.[model.slice(slash + 1)];
    for (const provider of lists) {
      const price = this.#table[provider]?.[model];
      if (price !== undefined) return price;
    }
    return undefined;
  }

  // Cached input is part of the input, at its own price where the list gives one.
  estimate(model: string | undefined, lists: string[], usage: TokenUsage): number | undefined {
    if (model === undefined) return undefined;
    const price = this.#priceOf(model, lists);
    if (price === undefined) return undefined;
    const cached = usage.cachedInputTokens ?? 0;
    const dollars =
      (usage.inputTokens - cached) * price.input +
      cached * (price.cacheRead ?? price.input) +
      usage.outputTokens * price.output;
    return Math.max(0, dollars) / 1_000_000;
  }
}
