import type { PermissionMode, VendorApp } from "@office-town/contract";
import { z } from "zod";
import type {
  AccountSupport,
  Adapter,
  HarnessCommand,
  InstallSupport,
  LaunchOptions,
  VendorAppSupport,
} from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";
import { catalog, catalog2, PREFERRED } from "./catalog.ts";
import { recount, recount2 } from "./recount.ts";

type Rule = "ask" | "allow";

const PERMISSIONS: Record<PermissionMode, { edit: Rule; bash: Rule; webfetch: Rule }> = {
  ask: { edit: "ask", bash: "ask", webfetch: "ask" },
  bypass: { edit: "allow", bash: "allow", webfetch: "allow" },
};

// OpenCode 1.18 lacks ACP's additionalDirectories, so extra folders go through its own rule.
function externalFolders(paths: string[] | undefined) {
  if (paths === undefined || paths.length === 0) return {};
  const rules = paths.map((path) => {
    const separator = path.includes("\\") ? "\\" : "/";
    return [`${path.replace(/[\\/]+$/, "")}${separator}*`, "allow"];
  });
  return { external_directory: Object.fromEntries(rules) };
}

// One inline config for both releases (D-97): OpenCode 2 reads OpenCode 1's permission rules as
// they are, and each ignores the other's switch for turning a server off.
function buildCommand(options: LaunchOptions): HarnessCommand {
  // The core's own tools never ask, even under a user's stricter rules; their effects are guarded.
  const toolRules = options.toolServers.map((server) => [`${server.name}_*`, "allow"]);
  // The user's own servers: an allowed one asks before each call, which the core answers by its
  // permission (D-96); any other is turned off for this session.
  const appRules = (options.vendorApps ?? []).map((name) => [`${name}_*`, "ask"]);
  const blocked = options.blockedApps ?? [];
  // OpenCode merges this inline config over the user's own, so nothing on disk is touched.
  const config = {
    permission: {
      ...PERMISSIONS[options.permissionMode],
      ...externalFolders(options.additionalPaths),
      // OpenCode 2's Code Mode would wrap every MCP call in one script, hiding which tool runs.
      execute: "deny",
      ...Object.fromEntries(appRules),
      ...Object.fromEntries(toolRules),
    },
    ...(blocked.length === 0
      ? {}
      : {
          mcp: Object.fromEntries(blocked.map((name) => [name, { enabled: false }])),
          policies: blocked.map((name) => ({ action: "mcp.use", resource: name, effect: "deny" })),
        }),
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  return {
    binary: "opencode",
    args: ["acp"],
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      ...(options.isolated ? ISOLATED : {}),
      ...(options.accountFolder === undefined ? {} : accounts.env(options.accountFolder)),
    },
  };
}

// Its keys and its sessions live in its data folder, so an account moves that folder (D-61).
const accounts: AccountSupport = {
  env: (folder) => ({ XDG_DATA_HOME: folder }),
  credentials: "opencode/auth.json",
  keyLogin: (provider) => ({
    command: { binary: "opencode", args: ["auth", "login", "--provider", provider] },
    // Its prompt takes Enter as a carriage return, as a terminal sends it.
    input: (key) => `${key}\r`,
  }),
};

// OpenCode 2 asks for a key only in a terminal, but imports one from stdin; it keeps keys in its
// database, so the app remembers the sign-ins it saw finish.
const accounts2: AccountSupport = {
  env: accounts.env,
  keyLogin: (provider) => ({
    command: { binary: "opencode", args: ["auth", "import", "--standalone"] },
    input: (key) =>
      JSON.stringify([
        {
          id: `cred_officetown_${provider}`,
          integrationID: provider,
          label: "Office Town",
          active: true,
          value: { type: "key", key },
        },
      ]),
  }),
};

// Its free models run without a sign-in, so being installed is enough to start. A new install
// gets OpenCode 2, which takes the same command name and folders (D-97).
const install: InstallSupport = {
  version: { binary: "opencode", args: ["--version"] },
  windows: "npm install -g @opencode/cli",
  unix: "curl -fsSL https://opencode.ai/v2/install | bash",
  page: "https://opencode.ai/download",
  // OpenCode 2 supports no Windows package manager, so npm when Node.js is here, else the command.
  installers: {
    windows: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "@opencode/cli"] },
      },
    ],
    unix: [
      {
        needs: "curl",
        command: {
          binary: "bash",
          args: ["-c", "curl -fsSL https://opencode.ai/v2/install | bash"],
        },
      },
    ],
  },
  folders: [".opencode/bin"],
};

// Its global config and global instructions still load (D-41).
const ISOLATED = {
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
};

const serverSchema = z.looseObject({
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
type Server = z.infer<typeof serverSchema>;

// The MCP servers in the user's own OpenCode settings, as OpenCode resolves them; it signs in to
// them and keeps their sign-ins itself. Their tools are known only once an agent uses them.
function appsOf(servers: Iterable<[string, Server]>): { apps: VendorApp[]; pending: boolean } {
  const apps: VendorApp[] = [...servers]
    .filter(([, server]) => server.enabled !== false && server.disabled !== true)
    .map(([name]) => ({ name, id: name, status: "connected", tools: [] }));
  return { apps, pending: false };
}

const configSchema = z.looseObject({ mcp: z.record(z.string(), serverSchema).optional() });

// OpenCode 1 prints the config it resolved, after anything it logs.
const vendorApps: VendorAppSupport = {
  command: { binary: "opencode", args: ["debug", "config"] },
  read(output) {
    const text = output.join("\n");
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    return appsOf(Object.entries(configSchema.parse(JSON.parse(text.slice(start))).mcp ?? {}));
  },
};

const sourcesSchema = z.array(
  z.looseObject({
    info: z
      .looseObject({
        mcp: z.looseObject({ servers: z.record(z.string(), serverSchema).optional() }).optional(),
      })
      .optional(),
  }),
);

// OpenCode 2 prints each source it read, in order, and a later entry for a server replaces an
// earlier one. A private server, so the call neither starts nor reaches the user's background one.
const vendorApps2: VendorAppSupport = {
  command: { binary: "opencode", args: ["debug", "config", "--standalone"] },
  read(output) {
    const text = output.join("\n");
    const start = text.indexOf("[");
    if (start === -1) return undefined;
    const sources = sourcesSchema.parse(JSON.parse(text.slice(start)));
    return appsOf(new Map(sources.flatMap(({ info }) => Object.entries(info?.mcp?.servers ?? {}))));
  },
};

const opencode1 = createAcpAdapter({
  harness: "opencode",
  name: "OpenCode",
  maker: "Anomaly",
  summary: "An open-source coding agent with free models and many providers.",
  needs: "Has free models. No account needed",
  usagePage: "https://opencode.ai/auth",
  capabilities: {
    reasoning: true,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: false,
    images: true,
    isolation: "partial",
  },
  isolationNote: "OpenCode's global settings and instructions still load.",
  toolPrefixes: (server) => [`${server}_`],
  preferred: PREFERRED,
  catalog,
  accounts,
  install,
  recount,
  vendorApps,
  buildCommand,
});

// OpenCode 2 runs its side commands differently; its sessions start as OpenCode 1's do (D-97).
const opencode2: Adapter = {
  ...opencode1,
  catalog: catalog2,
  accounts: accounts2,
  recount: recount2,
  vendorApps: vendorApps2,
};

const majorOf = (version: string) => Number.parseInt(version, 10);

export const opencodeAdapter: Adapter = {
  ...opencode1,
  forVersion: (version) => (majorOf(version) >= 2 ? opencode2 : opencode1),
};
