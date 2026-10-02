import { z } from "zod";

export const environmentSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("wsl"), distro: z.string().min(1) }),
]);
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

export const permissionModeSchema = z.enum(["ask", "acceptEdits", "bypass"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

// These values become command-line arguments of a harness, so they may not look like a flag.
const harnessSettingSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/:@[\]-]*$/,
    "Must start with a letter or digit and contain only letters, digits and . _ - / : @ [ ]",
  );

// Tokens count what the model newly read and wrote; input served from the cache is left out.
export const budgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
});
export type Budget = z.infer<typeof budgetSchema>;

export const sessionOptionsSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  workspacePath: z.string().min(1).optional(),
  model: harnessSettingSchema.optional(),
  effort: harnessSettingSchema.optional(),
  permissionMode: permissionModeSchema,
  budget: budgetSchema.optional(),
  // The harness's own id of an earlier session to continue, as reported by `session.started`.
  resumeSessionId: harnessSettingSchema.optional(),
});
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;
