import { z } from "zod";

export const adapterCapabilitiesSchema = z.object({
  reasoning: z.boolean(),
  plan: z.boolean(),
  effort: z.boolean(),
  modelList: z.boolean(),
  resume: z.boolean(),
  usageLimits: z.boolean(),
  // How far an isolated session keeps out instruction files, memory, MCP servers and plugins.
  isolation: z.enum(["full", "partial", "none"]),
});
export type AdapterCapabilities = z.infer<typeof adapterCapabilitiesSchema>;
