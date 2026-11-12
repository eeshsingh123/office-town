import type { VendorApp } from "@office-town/contract";
import type {
  AccountSupport,
  Adapter,
  AttachedToolServer,
  CatalogQuery,
  HarnessCommand,
  HarnessQuery,
  InstallSupport,
  LaunchOptions,
  VendorAppSupport,
} from "../../adapter.ts";
import { answerIn } from "../../json-rpc.ts";
import {
  accountSchema,
  mcpStatusListSchema,
  modelListSchema,
  pluginReadSchema,
  rateLimitsNoticeSchema,
  type StatusTool,
} from "./messages.ts";
import { CLIENT_INFO, CodexTranslator, limitsOf } from "./translator.ts";

const APP_SERVER = { binary: "codex", args: ["app-server"] };

// The token is passed in a variable the config names, so it stays off the command line.
const tokenVariable = (index: number) => `OFFICE_TOWN_TOOL_TOKEN_${index}`;

// The variables of a stdio server that carry its token, which Codex passes on from its own.
const secretVariables = (server: Extract<AttachedToolServer, { transport: "stdio" }>) =>
  Object.keys(server.env).filter((name) => server.env[name]?.includes(server.token));

// Each value is TOML; a JSON string or array of strings is valid TOML too.
function serverConfig(server: AttachedToolServer, index: number): string[] {
  const key = `mcp_servers.${server.name}`;
  const settings: [string, unknown][] =
    server.transport === "http"
      ? [
          ["url", server.url],
          ["bearer_token_env_var", tokenVariable(index)],
        ]
      : [
          ["command", server.command],
          ["args", server.args],
          ["env_vars", secretVariables(server)],
          ...Object.entries(server.env)
            .filter(([name]) => !secretVariables(server).includes(name))
            .map(([name, value]): [string, unknown] => [`env.${name}`, value]),
        ];
  // The core's own tools never ask: what they lead to is guarded where it happens.
  settings.push(["default_tools_approval_mode", "auto"]);
  return settings.flatMap(([name, value]) => ["-c", `${key}.${name}=${JSON.stringify(value)}`]);
}

// The server that carries every ChatGPT app, each tool marked with its app.
const APPS_SERVER = "codex_apps";
// OpenAI's own helpers that do nothing for an agent here (owner, D-96): Pets, parental controls,
// charts drawn in the Codex app, and documents open in it. They are never listed or turned on.
const HIDDEN_APPS = new Set([
  "connector_openai_chatgpt_pets",
  "connector_openai_safety_settings",
  "connector_openai_visualize",
  "connector_openai_codex_document_control",
]);
const isApp = (id: string) => id.startsWith("connector_");

// Every ChatGPT app starts off; the ones the agent may use are turned on and ask before each call,
// which the core answers by the app's permission. Another MCP server of the login is turned off
// unless allowed, and an allowed one asks the same way. Only `-c` overrides: nothing on disk.
function appSettings({ vendorApps = [], blockedApps = [] }: LaunchOptions): string[] {
  const settings: [string, unknown][] = [["apps._default.enabled", false]];
  for (const id of vendorApps) {
    const key = isApp(id) ? `apps.${id}` : `mcp_servers.${id}`;
    if (isApp(id)) settings.push([`${key}.enabled`, true]);
    settings.push([`${key}.default_tools_approval_mode`, "prompt"]);
  }
  for (const id of blockedApps.filter((blocked) => !isApp(blocked))) {
    settings.push([`mcp_servers.${id}.enabled`, false]);
  }
  return settings.flatMap(([name, value]) => ["-c", `${name}=${JSON.stringify(value)}`]);
}

function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = [
    ...APP_SERVER.args,
    ...options.toolServers.flatMap(serverConfig),
    ...appSettings(options),
  ];
  // Codex reads everywhere, so a read-only folder is left out of the folders it may write.
  const readOnly = new Set(options.readOnlyPaths ?? []);
  const paths = (options.additionalPaths ?? []).filter((path) => !readOnly.has(path));
  if (paths.length > 0) {
    args.push("-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(paths)}`);
  }
  const env: Record<string, string> = {
    ...(options.accountFolder === undefined ? {} : accounts.env(options.accountFolder)),
  };
  options.toolServers.forEach((server, index) => {
    if (server.transport === "http") env[tokenVariable(index)] = server.token;
    else for (const name of secretVariables(server)) env[name] = server.env[name] ?? "";
  });
  return Object.keys(env).length === 0
    ? { binary: APP_SERVER.binary, args }
    : { binary: APP_SERVER.binary, args, env };
}

// The app-server answers one request after its handshake, without starting a turn. It quits as
// soon as its input closes, so it is a server.
function appServerQuery<T>(
  method: string,
  read: (result: unknown) => T,
  params: object = {},
): HarnessQuery<T> {
  return {
    command: APP_SERVER,
    server: true,
    input: [
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: CLIENT_INFO, capabilities: null },
      }),
      JSON.stringify({ method: "initialized", params: {} }),
      JSON.stringify({ id: 2, method, params }),
    ],
    read(output) {
      const answer = answerIn(output, 2);
      return answer === undefined ? undefined : read(answer.result);
    },
  };
}

// Listed without a sign-in; hidden models are the ones its own picker leaves out.
const catalog: CatalogQuery = appServerQuery("model/list", (result) => ({
  models: modelListSchema
    .parse(result)
    .data.filter((model) => !model.hidden)
    .map((model) => ({
      id: model.id,
      name: model.displayName,
      ...(model.description ? { description: model.description } : {}),
      efforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      ...(model.inputModalities?.includes("image") ? { inputs: ["image" as const] } : {}),
    })),
}));

// CODEX_HOME moves its whole login. It may keep the sign-in in the system's credential store, so
// whether it is signed in is asked, never read from a file.
const accounts: AccountSupport = {
  env: (folder) => ({ CODEX_HOME: folder }),
  // Opens the browser and waits on a local page for its answer.
  login: { binary: "codex", args: ["login"] },
  status: appServerQuery("account/read", (result) => {
    const { account } = accountSchema.parse(result);
    if (account === null) return { signedIn: false };
    const plan = account.type === "apiKey" ? "API key" : (account.planType ?? undefined);
    return {
      signedIn: true,
      ...(account.email ? { email: account.email } : {}),
      ...(plan === undefined ? {} : { plan }),
    };
  }),
  home: ".codex",
  limits: appServerQuery("account/rateLimits/read", (result) =>
    limitsOf(rateLimitsNoticeSchema.parse(result).rateLimits),
  ),
};

function appTools(tools: StatusTool[]): VendorApp["tools"] {
  return tools.map((tool) => ({
    name: tool.name.replace(/^[^.]+./, ""),
    ...(tool.description ? { description: tool.description } : {}),
    readOnly: tool.annotations?.readOnlyHint === true,
  }));
}

// The login's apps, from one status list: each ChatGPT app by the tools marked with it, and each
// other server as an app of its own.
function appsOf(result: unknown): VendorApp[] {
  const apps: VendorApp[] = [];
  for (const server of mcpStatusListSchema.parse(result).data) {
    const tools = Object.values(server.tools);
    if (server.name !== APPS_SERVER) {
      apps.push({
        name: server.name,
        id: server.name,
        status:
          server.authStatus === "notLoggedIn"
            ? "needs_sign_in"
            : server.toolsError
              ? "failed"
              : "connected",
        tools: appTools(tools),
      });
      continue;
    }
    const byApp = Map.groupBy(tools, (tool) => tool._meta?.connector_id ?? "");
    for (const [id, own] of byApp) {
      if (id === "" || HIDDEN_APPS.has(id)) continue;
      const name = own[0]?._meta?.connector_name ?? id;
      apps.push({ name, id, status: "connected", tools: appTools(own) });
    }
  }
  return apps;
}

const STATUS_REQUEST = JSON.stringify({
  id: 2,
  method: "mcpServerStatus/list",
  params: { detail: "toolsAndAuthOnly" },
});

// Read from the app-server without a turn; Codex signs in to and keeps every app itself.
// ChatGPT's plugins carry its apps; a catalog slug such as "hugging-face" is its plugin "huggingface".
const PLUGINS = "openai-curated-remote";

const vendorApps: VendorAppSupport = {
  command: APP_SERVER,
  allOff: true,
  // The plugin's app names the ChatGPT page where the user connects it; nothing is installed here
  // (0.167.2). Connected there, it reaches Codex with the account.
  setUp: (app) =>
    appServerQuery(
      "plugin/read",
      (result) => {
        const { apps } = pluginReadSchema.parse(result).plugin;
        const page = apps.find(({ installUrl }) => installUrl)?.installUrl;
        if (!page) throw new Error(`${app} has no app to sign in to in Codex.`);
        return page;
      },
      {
        pluginName: app.toLowerCase().replaceAll(/[^a-z0-9]+/g, ""),
        remoteMarketplaceName: PLUGINS,
      },
    ),
  start: [
    JSON.stringify({
      id: 1,
      method: "initialize",
      params: { clientInfo: CLIENT_INFO, capabilities: null },
    }),
    JSON.stringify({ method: "initialized", params: {} }),
    STATUS_REQUEST,
  ],
  poll: STATUS_REQUEST,
  read(output) {
    const answer = answerIn(output, 2);
    return answer === undefined ? undefined : { apps: appsOf(answer.result), pending: false };
  },
};

const install: InstallSupport = {
  version: { binary: "codex", args: ["--version"] },
  windows: "npm install -g @openai/codex",
  unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
  page: "https://developers.openai.com/codex/cli",
  installers: {
    windows: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "@openai/codex"] },
      },
    ],
    unix: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "@openai/codex"] },
      },
      {
        needs: "curl",
        command: {
          binary: "sh",
          args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
        },
      },
    ],
  },
  folders: [".local/bin"],
};

export const codexAdapter: Adapter = {
  harness: "codex",
  name: "Codex",
  maker: "OpenAI",
  summary: "OpenAI's coding agent, with the GPT models in your ChatGPT plan.",
  needs: "Works with a ChatGPT plan",
  priceLists: ["openai"],
  capabilities: {
    reasoning: true,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: true,
    images: true,
    isolation: "partial",
  },
  isolationNote: "Your Codex settings file and AGENTS.md files still load.",
  catalog,
  accounts,
  install,
  vendorApps,
  buildCommand,
  createTranslator: (options) => new CodexTranslator(options),
};
