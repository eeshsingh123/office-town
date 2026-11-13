import { z } from "zod";

// `steps`: a sub-agent's own steps reach us, not only its prompt and result. `wakes`: once a
// sub-agent that outlived the turn ends, the CLI starts a turn of its own that we see.
export const subAgentSupportSchema = z.object({ steps: z.boolean(), wakes: z.boolean() });
export type SubAgentSupport = z.infer<typeof subAgentSupportSchema>;

export const adapterCapabilitiesSchema = z.object({
  reasoning: z.boolean(),
  plan: z.boolean(),
  effort: z.boolean(),
  modelList: z.boolean(),
  resume: z.boolean(),
  usageLimits: z.boolean(),
  // Its protocol can carry an image inside a prompt.
  images: z.boolean(),
  // How far an isolated session keeps out instruction files, memory, MCP servers and plugins.
  isolation: z.enum(["full", "partial", "none"]),
  subAgents: subAgentSupportSchema,
});
export type AdapterCapabilities = z.infer<typeof adapterCapabilitiesSchema>;
