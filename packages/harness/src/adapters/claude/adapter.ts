import type { PermissionMode, UsageLimit, VendorApp } from "@office-town/contract";
import type {
  AccountSupport,
  Adapter,
  AttachedToolServer,
  CatalogQuery,
  HarnessCommand,
  InstallSupport,
  LaunchOptions,
  VendorAppSupport,
} from "../../adapter.ts";
import {
  authStatusSchema,
  credentialsSchema,
  headerSchema,
  initializeResponseSchema,
  mcpStatusResponseSchema,
  planUsageSchema,
} from "./messages.ts";
import { appToolPrefix, ClaudeTranslator } from "./translator.ts";

const STREAM_ARGS = [
  "--print",
  "--verbose",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
];

const PERMISSION_MODES: Record<PermissionMode, string> = {
  ask: "default",
  bypass: "bypassPermissions",
};

// The config is on the command line, which others can read, so it names a variable Claude fills in (D-41).
const tokenVariable = (index: number) => `OFFICE_TOWN_TOOL_TOKEN_${index}`;

function mcpConfigOf(server: AttachedToolServer, index: number) {
  const hidden = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value.replaceAll(server.token, `\${${tokenVariable(index)}}`),
      ]),
    );
  return server.transport === "http"
    ? { type: "http", url: server.url, headers: hidden(server.headers) }
    : { type: "stdio", command: server.command, args: server.args, env: hidden(server.env) };
}

// The login's other apps are blocked; every call to an allowed one asks, even where the user's
// own settings allow it, because the core decides it by the app's permission (D-68).
function appSettings({ vendorApps = [], blockedApps = [] }: LaunchOptions) {
  return {
    deniedMcpServers: blockedApps.map((serverName) => ({ serverName })),
    permissions: { ask: vendorApps.map((app) => appToolPrefix(app).slice(0, -2)) },
  };
}

function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = [
    ...STREAM_ARGS,
    // Adds the text of a reply as it is produced, ahead of the whole message.
    "--include-partial-messages",
    // Routes permission prompts to us as control requests on stdout.
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    PERMISSION_MODES[options.permissionMode],
  ];
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.effort !== undefined) args.push("--effort", options.effort);
  if (options.resumeSessionId !== undefined) args.push("--resume", options.resumeSessionId);
  if (options.toolServers.length > 0) {
    const servers = options.toolServers.map((server, index) => [
      server.name,
      mcpConfigOf(server, index),
    ]);
    args.push("--mcp-config", JSON.stringify({ mcpServers: Object.fromEntries(servers) }));
    // The core's own tools never ask: what they lead to is guarded where it happens.
    args.push("--allowedTools", ...options.toolServers.map((server) => `mcp__${server.name}`));
  }
  // --bare would isolate more, but takes only an API key, never the subscription login (D-41).
  // No --strict-mcp-config: it drops Claude apps too, and the empty setting sources already keep
  // the user's own MCP servers out.
  if (options.isolated) args.push("--setting-sources", "", "--disable-slash-commands");
  const apps = options.vendorApps ?? [];
  if (apps.length > 0) args.push("--settings", JSON.stringify(appSettings(options)));
  for (const path of options.additionalPaths ?? []) args.push("--add-dir", path);
  const env = {
    ...(options.accountFolder === undefined ? {} : accounts.env(options.accountFolder)),
    ...(apps.length === 0 ? { ENABLE_CLAUDEAI_MCP_SERVERS: "false" } : {}),
    ...Object.fromEntries(
      options.toolServers.map((server, index) => [tokenVariable(index), server.token]),
    ),
  };
  return Object.keys(env).length === 0
    ? { binary: "claude", args }
    : { binary: "claude", args, env };
}

// The CLI describes itself in its answer to an initialize request, without starting a turn.
const catalog: CatalogQuery = {
  command: { binary: "claude", args: STREAM_ARGS },
  input: [
    JSON.stringify({
      type: "control_request",
      request_id: "catalog",
      request: { subtype: "initialize" },
    }),
  ],
  parse(output) {
    const answer = output
      .map((line): unknown => JSON.parse(line))
      .find((message) => headerSchema.parse(message).type === "control_response");
    const { models } = initializeResponseSchema.parse(answer).response.response;
    return {
      models: models.map((model) => ({
        id: model.value,
        name: model.displayName,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(model.resolvedModel === undefined ? {} : { resolvedId: model.resolvedModel }),
        efforts: model.supportedEffortLevels ?? [],
        // Every Claude model reads images and PDFs.
        inputs: ["image", "pdf"],
      })),
    };
  },
};

// What the CLI's /usage reads; the windows it shows are the ones kept.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USAGE_WINDOWS = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

// Reads with the CLI's own token and never refreshes it: refreshing would replace the CLI's
// sign-in under it. An expired token waits for the next agent run, which refreshes it.
async function readLimits(credentials: string): Promise<UsageLimit[] | undefined> {
  const oauth = credentialsSchema.parse(JSON.parse(credentials)).claudeAiOauth;
  if (oauth === undefined || (oauth.expiresAt ?? Infinity) <= Date.now()) return undefined;
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return undefined;
  const usage = planUsageSchema.parse(await response.json());
  return USAGE_WINDOWS.flatMap((id) => {
    const window = usage[id];
    if (window === undefined) return [];
    const resetsAt = window.resets_at == null ? undefined : new Date(window.resets_at);
    return [
      {
        id,
        label: id.replaceAll("_", " "),
        usedFraction: Math.max(0, window.utilization) / 100,
        ...(resetsAt === undefined || Number.isNaN(resetsAt.getTime())
          ? {}
          : { resetsAt: resetsAt.toISOString() }),
      },
    ];
  });
}

// Each account is a config folder of its own, which holds its login (D-61).
const accounts: AccountSupport = {
  env: (folder) => ({ CLAUDE_CONFIG_DIR: folder }),
  credentials: ".credentials.json",
  login: { binary: "claude", args: ["auth", "login", "--claudeai"] },
  status: {
    command: { binary: "claude", args: ["auth", "status", "--json"] },
    parse(output) {
      const status = authStatusSchema.parse(JSON.parse(output));
      return {
        signedIn: status.loggedIn,
        ...(status.email === undefined ? {} : { email: status.email }),
        ...(status.subscriptionType === undefined ? {} : { plan: status.subscriptionType }),
      };
    },
  },
  home: ".claude",
  readLimits,
};

const APP_STATUS: Record<string, VendorApp["status"]> = {
  connected: "connected",
  "needs-auth": "needs_sign_in",
};

// The user's claude.ai connectors, which the CLI fetches for a subscription login.
const vendorApps: VendorAppSupport = {
  command: { binary: "claude", args: [...STREAM_ARGS, "--setting-sources", ""] },
  start: [
    JSON.stringify({
      type: "control_request",
      request_id: "init",
      request: { subtype: "initialize" },
    }),
  ],
  poll: JSON.stringify({
    type: "control_request",
    request_id: "apps",
    request: { subtype: "mcp_status" },
  }),
  read(line) {
    if (!line.startsWith("{")) return undefined;
    const parsed = mcpStatusResponseSchema.safeParse(JSON.parse(line));
    if (!parsed.success || parsed.data.response.request_id !== "apps") return undefined;
    const servers = parsed.data.response.response.mcpServers.filter(
      ({ source }) => source === "claudeai",
    );
    return {
      apps: servers.map((server) => ({
        name: server.name,
        status: APP_STATUS[server.status] ?? "failed",
        tools: (server.tools ?? []).map((tool) => ({
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          readOnly: tool.annotations?.readOnly === true,
        })),
      })),
      pending: servers.some(({ status }) => status === "pending"),
    };
  },
  // Claude prints its page and exits; the user signs in there, and the app works from the next run.
  signIn: (app) => ({ binary: "claude", args: ["mcp", "login", "--no-browser", app] }),
  signInPage: (output) =>
    output.map((line) => line.trim()).find((line) => line.startsWith("https://")),
};

const install: InstallSupport = {
  version: { binary: "claude", args: ["--version"] },
  windows: "irm https://claude.ai/install.ps1 | iex",
  unix: "curl -fsSL https://claude.ai/install.sh | bash",
  page: "https://claude.com/claude-code",
  installers: {
    // Defender flags its one-line installer run from another app as a trojan, so Windows users run
    // it themselves (owner, D-75).
    windows: [],
    unix: [
      {
        needs: "curl",
        command: { binary: "bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
      },
    ],
  },
  folder: ".local/bin",
};

export const claudeAdapter: Adapter = {
  harness: "claude",
  name: "Claude Code",
  // The CLI sends thinking blocks with their text left empty, so there is no reasoning to report.
  capabilities: {
    reasoning: false,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: true,
    images: true,
    isolation: "full",
  },
  catalog,
  accounts,
  install,
  vendorApps,
  buildCommand,
  createTranslator: (options) => new ClaudeTranslator(options.toolServers, options.vendorApps),
};
