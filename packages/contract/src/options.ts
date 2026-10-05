import { z } from "zod";

export const environmentSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("wsl"), distro: z.string().min(1) }),
]);
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

// The harness's own mode: it asks about everything, and the core's autonomy level answers what it
// allows (MODULES M4.6); or, under Bypass, it asks nothing.
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
  // Further folders the agent may use as freely as its workspace.
  additionalPaths: z.array(absolutePathSchema).optional(),
  model: harnessSettingSchema.optional(),
  effort: harnessSettingSchema.optional(),
  permissionMode: permissionModeSchema,
  // The harness's own id of an earlier session to continue, as reported by `session.started`.
  resumeSessionId: harnessSettingSchema.optional(),
});
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;
