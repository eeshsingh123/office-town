import { z } from "zod";

export const environmentSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("wsl"), distro: z.string().min(1) }),
]);
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

// Ask: the core's autonomy level answers every request. Bypass: the harness asks nothing.
export const permissionModeSchema = z.enum(["ask", "bypass"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

// These values become command-line arguments of a harness, so they may not look like a flag.
export const harnessSettingSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/:@[\]-]*$/,
    "Must start with a letter or digit and contain only letters, digits and . _ - / : @ [ ]",
  );

// A Windows drive or network path, or a POSIX one; never relative, which could read as a flag.
export const absolutePathSchema = z
  .string()
  .regex(/^([A-Za-z]:[\\/]|\\\\|\/)/, "Must be an absolute path");

export const sessionOptionsSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  workspacePath: z.string().min(1).optional(),
  // Folders the agent may use as freely as its workspace.
  additionalPaths: z.array(absolutePathSchema).optional(),
  // Also in additionalPaths: the agent may read them, never change them.
  readOnlyPaths: z.array(absolutePathSchema).optional(),
  model: harnessSettingSchema.optional(),
  effort: harnessSettingSchema.optional(),
  permissionMode: permissionModeSchema,
  // As reported by `session.started`.
  resumeSessionId: harnessSettingSchema.optional(),
  // For a clean-slate second opinion, as far as the harness allows.
  isolated: z.boolean().optional(),
});
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;
