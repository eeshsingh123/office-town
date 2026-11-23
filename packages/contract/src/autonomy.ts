import { z } from "zod";

// From least to most (D-40). Trusted was removed in D-57; stored Trusted became Full.
export const autonomySchema = z.enum(["supervised", "full", "bypass"]);
export type Autonomy = z.infer<typeof autonomySchema>;

// What new work may start at by default. No safety checks is never a default: it is picked for
// one task, behind its warning.
export const everydayAutonomySchema = z.enum(["supervised", "full"]);
export type EverydayAutonomy = z.infer<typeof everydayAutonomySchema>;

// A department sets the level; a profile or an agent may only lower it.
export function lowerAutonomy(level: Autonomy, cap: Autonomy | undefined): Autonomy {
  if (cap === undefined) return level;
  const order = autonomySchema.options;
  return order.indexOf(cap) < order.indexOf(level) ? cap : level;
}

// "app": an app's own permission answered it (D-68). "automation": an automation on Auto (D-126).
export const answeredBySchema = z.union([
  z.literal("user"),
  z.literal("app"),
  z.literal("automation"),
  z.object({ autonomy: autonomySchema }),
]);
export type AnsweredBy = z.infer<typeof answeredBySchema>;
