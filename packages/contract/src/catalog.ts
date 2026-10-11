import { z } from "zod";

export const harnessModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  // The full id a running session reports when `id` is an alias, such as "haiku".
  resolvedId: z.string().min(1).optional(),
  // Who serves the model, for a harness that offers models from several providers.
  provider: z.string().min(1).optional(),
  // Nothing, nothing beyond the user's plan, or a price per use.
  access: z.enum(["free", "plan", "paid"]).optional(),
  // In the harness's own words; empty when it has none.
  efforts: z.array(z.string().min(1)),
});
export type HarnessModel = z.infer<typeof harnessModelSchema>;

export const harnessCatalogSchema = z.object({ models: z.array(harnessModelSchema) });
export type HarnessCatalog = z.infer<typeof harnessCatalogSchema>;
