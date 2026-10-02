import { z } from "zod";

export const environmentSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({ kind: z.literal("wsl"), distro: z.string().min(1) }),
]);
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

export const permissionModeSchema = z.enum(["ask", "acceptEdits", "bypass"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const sessionOptionsSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  workspacePath: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  permissionMode: permissionModeSchema,
});
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;
