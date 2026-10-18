import { z } from "zod";
import { audienceSchema, givenToSchema } from "./audience.ts";
import { teamToolServer } from "./events.ts";

// The hub's two tools reach any app an agent may use now (D-67).
export const appsToolServer = "office-town-apps";

// The MCP server name an agent sees. Short, so "mcp__<slug>__<tool>" stays within 64 characters.
export const connectorSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,23}$/, "Use up to 24 lowercase letters, digits and -")
  .refine((slug) => slug !== teamToolServer && slug !== appsToolServer, "That name is taken");

// A Claude app is one of the user's claude.ai connectors, reached by Claude agents only (D-68).
export const connectorKindSchema = z.enum(["remote", "local", "claude"]);
export const connectorAuthSchema = z.enum(["key", "none"]);
export type ConnectorAuth = z.infer<typeof connectorAuthSchema>;
export const connectorPermissionSchema = z.enum(["read_only", "ask", "dont_ask"]);
export type ConnectorPermission = z.infer<typeof connectorPermissionSchema>;
// Signed out: a Claude app that still needs its sign-in in Claude Code.
export const connectorStatusSchema = z.enum(["connected", "signed_out", "off", "failing"]);
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

// A value the user pastes: a header of a remote app or a variable of a local one. An
// "Authorization" header is sent as a bearer token. The value lives in the credential store.
export const connectorKeySchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Use letters, digits, _ and -"),
  label: z.string().min(1),
  // Where the app shows the key.
  link: z.url().optional(),
});
export type ConnectorKey = z.infer<typeof connectorKeySchema>;

// How to reach an app; the same for one from the catalog and one the user added.
export const connectorSetupSchema = z
  .object({
    slug: connectorSlugSchema,
    name: z.string().trim().min(1).max(60),
    kind: connectorKindSchema,
    maker: z.string().min(1).optional(),
    official: z.boolean(),
    url: z.url().optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    // A Claude app's account, and its name in Claude Code, such as "claude.ai Gmail".
    account: z.string().min(1).optional(),
    app: z.string().min(1).optional(),
    auth: connectorAuthSchema,
    keys: z.array(connectorKeySchema).max(5),
  })
  .refine((setup) => {
    if (setup.kind === "remote") return setup.url !== undefined;
    if (setup.kind === "local") return setup.command !== undefined;
    // A catalog tile names no account; a saved Claude app always has one (D-68).
    return true;
  }, "A remote app needs an address, a local one a command");
export type ConnectorSetup = z.infer<typeof connectorSetupSchema>;

export const connectorRecordSchema = z.object({
  id: z.string().min(1),
  setup: connectorSetupSchema,
  // App-wide, not per workspace; guests never get connectors.
  audience: audienceSchema,
  permission: connectorPermissionSchema,
  enabled: z.boolean(),
  status: connectorStatusSchema,
  createdAt: z.iso.datetime(),
});
export type ConnectorRecord = z.infer<typeof connectorRecordSchema>;

// By key name; sent once, kept only in the credential store.
const keyValuesSchema = z.record(z.string(), z.string().min(1).max(4096));

export const newConnectorRequestSchema = z.object({
  setup: connectorSetupSchema,
  audience: givenToSchema,
  permission: connectorPermissionSchema,
  keys: keyValuesSchema.optional(),
});
export type NewConnectorRequest = z.infer<typeof newConnectorRequestSchema>;

// Tried before saving; a local program runs only after the user saw its command.
export const connectorTestRequestSchema = z.object({
  setup: connectorSetupSchema,
  keys: keyValuesSchema.optional(),
});
export type ConnectorTestRequest = z.infer<typeof connectorTestRequestSchema>;

export const connectorTestSchema = z.object({ tools: z.number().int().nonnegative() });
export type ConnectorTest = z.infer<typeof connectorTestSchema>;

export const connectorChangeSchema = z.object({
  audience: givenToSchema.optional(),
  permission: connectorPermissionSchema.optional(),
  enabled: z.boolean().optional(),
  // A new key, replacing the old one.
  keys: keyValuesSchema.optional(),
});
export type ConnectorChange = z.infer<typeof connectorChangeSchema>;

// Claude's page for a Claude app's sign-in, opened in the system browser.
export const connectorSignInSchema = z.object({ url: z.url() });
export type ConnectorSignIn = z.infer<typeof connectorSignInSchema>;

export const connectorCallOutcomeSchema = z.enum(["done", "refused", "failed", "asked"]);
export type ConnectorCallOutcome = z.infer<typeof connectorCallOutcomeSchema>;

export const connectorCallSchema = z.object({
  id: z.string().min(1),
  // Grows with every call; pages are read by it.
  position: z.number().int().positive(),
  connectorId: z.string().min(1),
  agentId: z.string().min(1),
  taskId: z.string().min(1),
  // The agent's department when it made the call.
  departmentId: z.string().min(1).optional(),
  tool: z.string().min(1),
  input: z.unknown(),
  change: z.boolean(),
  outcome: connectorCallOutcomeSchema,
  at: z.iso.datetime(),
});
export type ConnectorCall = z.infer<typeof connectorCallSchema>;

export const connectorActivityQuerySchema = z.object({
  // A department id, or "none" for agents without one.
  team: z.string().min(1).optional(),
  changes: z.stringbool().optional(),
  before: z.coerce.number().int().positive().optional(),
});
export type ConnectorActivityQuery = z.infer<typeof connectorActivityQuerySchema>;

// This week's calls, newest first; the counts ignore the filters, for the chips.
export const connectorActivitySchema = z.object({
  calls: z.array(connectorCallSchema),
  total: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
  teams: z.array(
    z.object({ departmentId: z.string().min(1).optional(), count: z.number().int().positive() }),
  ),
  // Pass as `before` for the next page.
  next: z.number().int().positive().optional(),
});
export type ConnectorActivity = z.infer<typeof connectorActivitySchema>;

export const connectorCategorySchema = z.enum(["work", "code", "messages", "sales", "design"]);
export type ConnectorCategory = z.infer<typeof connectorCategorySchema>;

// An official app: a key app checked to connect before it was listed, or a Claude app's tile.
// Its slug is its logo key.
export const catalogEntrySchema = z.object({
  setup: connectorSetupSchema,
  category: connectorCategorySchema,
  // What agents can do with it, in one line.
  description: z.string().min(1),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

export const connectorCatalogSchema = z.object({
  entries: z.array(catalogEntrySchema),
  // Where pasted keys go: the OS credential store, a file only the user can read (Linux without
  // a store), or nowhere, so keys cannot be saved (Windows without a store).
  keys: z.enum(["store", "file", "none"]),
});
export type ConnectorCatalog = z.infer<typeof connectorCatalogSchema>;

// An app a harness connects itself for a login, as the CLI reports it (D-68).
export const vendorAppSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["connected", "needs_sign_in", "failed"]),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      readOnly: z.boolean(),
    }),
  ),
});
export type VendorApp = z.infer<typeof vendorAppSchema>;
