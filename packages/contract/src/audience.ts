import { z } from "zod";

// Everyone, or the departments and agents named (D-64, D-67).
export const audienceSchema = z.object({
  everyone: z.boolean(),
  departmentIds: z.array(z.string().min(1)),
  agentIds: z.array(z.string().min(1)),
});
export type Audience = z.infer<typeof audienceSchema>;

// A request always gives something to someone.
export const givenToSchema = audienceSchema.refine(
  (audience) => audience.everyone || audience.departmentIds.length + audience.agentIds.length > 0,
  "Give it to everyone or to at least one department or agent",
);
