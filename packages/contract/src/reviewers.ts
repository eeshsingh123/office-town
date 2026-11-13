import { z } from "zod";
import { roleSettingsSchema } from "./team.ts";

// A saved way to review any task: what to look for, and the model that looks. A starter has no
// model until the user picks one at its first use.
export const reviewerRequestSchema = z.object({
  name: z.string().trim().min(1),
  // What it looks for, in a line.
  description: z.string().trim(),
  instructions: z.string().trim().min(1),
  settings: roleSettingsSchema.optional(),
});
export type ReviewerRequest = z.infer<typeof reviewerRequestSchema>;

export const reviewerRecordSchema = reviewerRequestSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type ReviewerRecord = z.infer<typeof reviewerRecordSchema>;
