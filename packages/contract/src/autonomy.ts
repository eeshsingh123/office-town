import { z } from "zod";

// How much an agent may do without asking the user (D-40, MODULES M4.6), from least to most.
export const autonomySchema = z.enum(["supervised", "trusted", "full", "bypass"]);
export type Autonomy = z.infer<typeof autonomySchema>;

// A department sets the level; a profile or an agent may only lower it.
export function lowerAutonomy(level: Autonomy, cap: Autonomy | undefined): Autonomy {
  if (cap === undefined) return level;
  const order = autonomySchema.options;
  return order.indexOf(cap) < order.indexOf(level) ? cap : level;
}

// Who let a harness's request through: the user, or the level that allowed it.
export const answeredBySchema = z.union([
  z.literal("user"),
  z.object({ autonomy: autonomySchema }),
]);
export type AnsweredBy = z.infer<typeof answeredBySchema>;
