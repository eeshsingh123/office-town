import { z } from "zod";
import { usageLimitSchema } from "./events.ts";
import { type EnvironmentSpec, environmentSpecSchema } from "./options.ts";

// One login on one harness. Without a folder it is the login the CLI already has (D-61).
export const accountSchema = z.object({
  id: z.string().min(1),
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  name: z.string().trim().min(1).max(40),
  // Its own login folder in the data folder, kept apart from the user's other logins.
  folder: z.string().min(1).optional(),
  // False while an added account has not finished signing in; Automatic skips it.
  signedIn: z.boolean().optional(),
  createdAt: z.iso.datetime(),
});
export type Account = z.infer<typeof accountSchema>;

// The login the CLI already has where an agent runs; native ids stay the bare harness.
export function defaultAccountId(harness: string, environment: EnvironmentSpec): string {
  return environment.kind === "native" ? harness : `${harness}@${environment.distro}`;
}

// The OpenCode providers an account can sign in to with a key from their console.
export const accountProviders = [
  { id: "opencode-go", label: "OpenCode Go" },
  { id: "opencode", label: "OpenCode Zen" },
] as const;

export const newAccountRequestSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  name: z.string().trim().min(1).max(40),
});
export type NewAccountRequest = z.infer<typeof newAccountRequestSchema>;

export const renameAccountRequestSchema = z.object({ name: z.string().trim().min(1).max(40) });
export type RenameAccountRequest = z.infer<typeof renameAccountRequestSchema>;

// A key for a harness that signs in with one, such as OpenCode; saved only in the account's folder.
export const accountKeyRequestSchema = z.object({
  provider: z.enum(accountProviders.map((provider) => provider.id)),
  key: z.string().trim().min(8),
});
export type AccountKeyRequest = z.infer<typeof accountKeyRequestSchema>;

// Who the harness says is signed in, read on demand.
export const accountStatusSchema = z.object({
  signedIn: z.boolean(),
  email: z.string().optional(),
  // Such as "pro" or "max"; OpenCode reports the provider instead.
  plan: z.string().optional(),
});
export type AccountStatus = z.infer<typeof accountStatusSchema>;

// A sign-in in progress. `url` is the page the CLI opened, to open again if it was closed;
// `code` is one the CLI shows for the user to enter on that page.
export const accountLoginSchema = z.object({
  state: z.enum(["waiting", "done", "failed"]),
  url: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type AccountLogin = z.infer<typeof accountLoginSchema>;

// The latest any session on this account reported.
export const accountLimitsSchema = z.object({
  accountId: z.string().min(1),
  harness: z.string().min(1),
  limits: z.array(usageLimitSchema),
  reportedAt: z.iso.datetime(),
});
export type AccountLimits = z.infer<typeof accountLimitsSchema>;

// Tokens one agent spent on one account since a time, for "Where it went".
export const accountUsageSchema = z.object({
  accountId: z.string().min(1),
  agentId: z.string().min(1),
  tasks: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
});
export type AccountUsage = z.infer<typeof accountUsageSchema>;

export const accountUsageQuerySchema = z.object({ since: z.iso.datetime() });

// Continues the agent's stopped work at `at`, such as when its plan resets.
export const resumeAtRequestSchema = z.object({ at: z.iso.datetime() });
export type ResumeAtRequest = z.infer<typeof resumeAtRequestSchema>;
