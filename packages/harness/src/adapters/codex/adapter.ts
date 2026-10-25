import { z } from "zod";
import type {
  AccountSupport,
  Adapter,
  AttachedToolServer,
  CatalogQuery,
  HarnessCommand,
  HarnessQuery,
  InstallSupport,
  LaunchOptions,
} from "../../adapter.ts";
import { accountSchema, modelListSchema, rateLimitsNoticeSchema } from "./messages.ts";
import { CodexTranslator, limitsOf } from "./translator.ts";

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

function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = [...APP_SERVER.args, ...options.toolServers.flatMap(serverConfig)];
  const paths = options.additionalPaths ?? [];
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

const answerSchema = z.looseObject({
  id: z.literal(2),
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});

// The app-server answers one request after its handshake, without starting a turn. It quits as
// soon as its input closes, so it is a server.
function appServerQuery<T>(
  method: string,
  read: (result: unknown) => T,
  params: object = {},
): HarnessQuery<T> {
  const clientInfo = { name: "office_town", title: "Office Town", version: "0.1.0" };
  return {
    command: APP_SERVER,
    server: true,
    input: [
      JSON.stringify({ id: 1, method: "initialize", params: { clientInfo, capabilities: null } }),
      JSON.stringify({ method: "initialized", params: {} }),
      JSON.stringify({ id: 2, method, params }),
    ],
    read(output) {
      for (const line of output) {
        if (!line.startsWith("{")) continue;
        const answer = answerSchema.safeParse(JSON.parse(line));
        if (!answer.success) continue;
        if (answer.data.error !== undefined) throw new Error(answer.data.error.message);
        return read(answer.data.result);
      }
      return undefined;
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
  buildCommand,
  createTranslator: (options) => new CodexTranslator(options),
};
