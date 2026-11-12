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

// Remote and local apps are shared: the core's hub serves them to every provider (D-67). The others
// are provider apps, which a provider signs in to and keeps itself, reached only by its own agents
// (D-68, D-96): the user's claude.ai connectors, Codex's ChatGPT apps and OpenCode's own servers.
export const connectorKindSchema = z.enum(["remote", "local", "claude", "codex", "opencode"]);
export type ConnectorKind = z.infer<typeof connectorKindSchema>;

const PROVIDER_OF: Partial<Record<ConnectorKind, string>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

// The provider whose agents alone reach an app, or undefined for a shared app every provider uses.
export const providerOf = (kind: ConnectorKind): string | undefined => PROVIDER_OF[kind];

// The kind of app a provider signs in to itself, or undefined for one without apps of its own.
export const kindOf = (provider: string): ConnectorKind | undefined =>
  connectorKindSchema.options.find((kind) => PROVIDER_OF[kind] === provider);

// Where the user adds an app to Claude; Claude Code loads it for the login (D-68).
export const claudeConnectorsPage = "https://claude.ai/customize/connectors";

export const workPlaceSchema = z.enum(["app", "background", "cloud"]);
export type WorkPlace = z.infer<typeof workPlaceSchema>;

// Where an app can be used: claude.ai apps also run on Claude's own cloud.
export const workPlacesOf = (kind: ConnectorKind): WorkPlace[] =>
  kind === "claude" ? ["app", "background", "cloud"] : ["app", "background"];

// The same app reached in several ways shows as one card: "Google Drive" through Claude and through
// Codex match by name, a shared app also by its catalog slug.
export const appKeyOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^claude\.ai /, "")
    .replaceAll(/[^a-z0-9]+/g, "");
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
    // A provider app's account, and its name or id in the provider, such as "claude.ai Gmail" or
    // Codex's "connector_gmail".
    account: z.string().min(1).optional(),
    app: z.string().min(1).optional(),
    auth: connectorAuthSchema,
    keys: z.array(connectorKeySchema).max(5),
  })
  .refine((setup) => {
    if (setup.kind === "remote") return setup.url !== undefined;
    if (setup.kind === "local") return setup.command !== undefined;
    // A catalog tile names no account; a saved provider app always has one (D-68).
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
  // How many actions it is known to have; a provider app with none has never been signed in.
  actions: z.number().int().nonnegative(),
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

// One action of an app, as the user reads it before saving and on the app's page.
export const connectorActionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  readOnly: z.boolean(),
});
export type ConnectorAction = z.infer<typeof connectorActionSchema>;

// What the app offers, shown before anything is saved.
export const connectorTestSchema = z.object({ tools: z.array(connectorActionSchema) });
export type ConnectorTest = z.infer<typeof connectorTestSchema>;

export const connectorChangeSchema = z.object({
  audience: givenToSchema.optional(),
  permission: connectorPermissionSchema.optional(),
  enabled: z.boolean().optional(),
  // A new key, replacing the old one.
  keys: keyValuesSchema.optional(),
});
export type ConnectorChange = z.infer<typeof connectorChangeSchema>;

// The provider's page for a provider app's sign-in, opened in the system browser. The provider
// holds the sign-in; Office Town never does (D-96).
export const connectorSignInSchema = z.object({ url: z.url() });
export type ConnectorSignIn = z.infer<typeof connectorSignInSchema>;

// Who an app connected through an agent's ask goes to; the department by default (D-96).
export const appAudienceSchema = z.enum(["agent", "department", "everyone"]);
export type AppAudience = z.infer<typeof appAudienceSchema>;

// Sets up an app through a provider that has none of it yet, by catalog slug or name.
export const providerSetupRequestSchema = z.object({
  provider: z.string().min(1),
  app: z.string().trim().min(1).max(60),
  // Set up from an agent's ask: who the user chose to give it to once it connects.
  ask: z.object({ requestId: z.string().min(1), audience: appAudienceSchema }).optional(),
});
export type ProviderSetupRequest = z.infer<typeof providerSetupRequestSchema>;

// The input of an agent's ask for an app, as Needs you shows it. Its answers are "give:<audience>",
// "connect", "decline"; a provider app names the provider whose sign-in it needs.
export const appAskSchema = z.object({
  app: z.string().min(1),
  reason: z.string(),
  provider: z.string().min(1).optional(),
  suggested: appAudienceSchema.optional(),
  // The asker's department, which "department" means.
  departmentId: z.string().min(1).optional(),
});
export type AppAsk = z.infer<typeof appAskSchema>;

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

// A vetted app: a shared app checked against the listing checklist, or a provider app's tile. Its
// slug is its logo key.
export const catalogEntrySchema = z.object({
  setup: connectorSetupSchema,
  category: connectorCategorySchema,
  // What agents can do with it, in one line.
  description: z.string().min(1),
  // Providers that can sign in to it themselves, besides how `setup` reaches it.
  signIn: z.array(z.string().min(1)).default([]),
  // When it last passed the checklist; checked again at each release (D-96).
  checked: z.iso.date(),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

// Whether an app is a vetted entry: by slug, or by the name a provider lists it under, which may be
// the maker's ("Atlassian" for Jira and Confluence).
export function isEntryApp(entry: CatalogEntry, app: { slug: string; name: string }): boolean {
  const key = appKeyOf(app.name);
  return (
    entry.setup.slug === app.slug ||
    key === appKeyOf(entry.setup.name) ||
    key === appKeyOf(entry.setup.maker ?? "")
  );
}

export const connectorCatalogSchema = z.object({
  entries: z.array(catalogEntrySchema),
  // Where pasted keys go: the OS credential store, a file only the user can read (Linux without
  // a store), or nowhere, so keys cannot be saved (Windows without a store).
  keys: z.enum(["store", "file", "none"]),
});
export type ConnectorCatalog = z.infer<typeof connectorCatalogSchema>;

// An app a harness connects itself for a login, as the CLI reports it (D-68). `id` is how the CLI
// names it in its settings, where that differs from its name.
export const vendorAppSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
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
