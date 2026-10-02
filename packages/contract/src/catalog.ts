import { z } from "zod";

export const harnessModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  // The effort values this model accepts, in the harness's own words. Empty when it has none.
  efforts: z.array(z.string().min(1)),
});
export type HarnessModel = z.infer<typeof harnessModelSchema>;

export const harnessCatalogSchema = z.object({ models: z.array(harnessModelSchema) });
export type HarnessCatalog = z.infer<typeof harnessCatalogSchema>;
