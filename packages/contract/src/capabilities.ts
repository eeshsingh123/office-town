import { z } from "zod";

export const adapterCapabilitiesSchema = z.object({
  reasoning: z.boolean(),
  plan: z.boolean(),
  effort: z.boolean(),
  modelList: z.boolean(),
  resume: z.boolean(),
});
export type AdapterCapabilities = z.infer<typeof adapterCapabilitiesSchema>;
