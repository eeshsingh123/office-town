import { z } from "zod";

// From least to most (D-40).
export const autonomySchema = z.enum(["supervised", "trusted", "full", "bypass"]);
export type Autonomy = z.infer<typeof autonomySchema>;

// A department sets the level; a profile or an agent may only lower it.
export function lowerAutonomy(level: Autonomy, cap: Autonomy | undefined): Autonomy {
  if (cap === undefined) return level;
  const order = autonomySchema.options;
  return order.indexOf(cap) < order.indexOf(level) ? cap : level;
}

export const answeredBySchema = z.union([
  z.literal("user"),
  z.object({ autonomy: autonomySchema }),
]);
export type AnsweredBy = z.infer<typeof answeredBySchema>;
