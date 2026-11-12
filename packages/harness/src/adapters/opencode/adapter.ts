import type { HarnessModel, PermissionMode, VendorApp } from "@office-town/contract";
import { z } from "zod";
import type {
  AccountSupport,
  CatalogQuery,
  HarnessCommand,
  InstallSupport,
  LaunchOptions,
  RecountSupport,
  VendorAppSupport,
} from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";

const modelSchema = z.looseObject({
  name: z.string(),
  providerID: z.string().min(1).optional(),
  cost: z.looseObject({ input: z.number(), output: z.number() }).optional(),
  capabilities: z
    .looseObject({
      toolcall: z.boolean(),
      input: z.looseObject({ image: z.boolean(), pdf: z.boolean() }).optional(),
    })
    .optional(),
  variants: z.record(z.string(), z.unknown()).optional(),
  // Some models list 0 for unknown.
  limit: z.looseObject({ context: z.number(), input: z.number() }).partial().optional(),
});
type Model = z.infer<typeof modelSchema>;

// OpenCode Go is OpenCode's own subscription; its models list a price but cost nothing beyond it.
const PLAN_PROVIDER = "opencode-go";

// OpenCode does not say what it would run, so the app names its default itself: free, and thinking
// as hard as it can. Free models come and go, so this applies only while OpenCode lists it.
const PREFERRED = { model: "opencode/deepseek-v4.1-flash-free", effort: "max" };

function inputsOf({ capabilities }: Model): HarnessModel["inputs"] {
  const input = capabilities?.input;
  if (input === undefined) return undefined;
  return [...(input.image ? ["image" as const] : []), ...(input.pdf ? ["pdf" as const] : [])];
}

// OpenCode compacts against what a model can take in, which some models list below their window.
function windowOf({ limit }: Model): number | undefined {
  const window = [limit?.input, limit?.context].find((size) => size !== undefined && size > 0);
  return window === undefined ? undefined : Math.floor(window);
}

function accessOf({ cost, providerID }: Model): HarnessModel["access"] {
  if (cost === undefined) return undefined;
  if (cost.input === 0 && cost.output === 0) return "free";
  return providerID === PLAN_PROVIDER ? "plan" : "paid";
}

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

function buildCommand(options: LaunchOptions): HarnessCommand {
  // The core's own tools never ask, even under a user's stricter rules; their effects are guarded.
  const toolRules = options.toolServers.map((server) => [`${server.name}_*`, "allow"]);
  // The user's own servers: an allowed one asks before each call, which the core answers by its
  // permission (D-96); any other is turned off for this session.
  const appRules = (options.vendorApps ?? []).map((name) => [`${name}_*`, "ask"]);
  const blocked = (options.blockedApps ?? []).map((name) => [name, { enabled: false }]);
  // OpenCode merges this inline config over the user's own, so nothing on disk is touched.
  const config = {
    permission: {
      ...PERMISSIONS[options.permissionMode],
      ...externalFolders(options.additionalPaths),
      ...Object.fromEntries(appRules),
      ...Object.fromEntries(toolRules),
    },
    ...(blocked.length === 0 ? {} : { mcp: Object.fromEntries(blocked) }),
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
  keyLogin: (provider) => ({ binary: "opencode", args: ["auth", "login", "--provider", provider] }),
};

// Its free models run without a sign-in, so being installed is enough to start.
const install: InstallSupport = {
  version: { binary: "opencode", args: ["--version"] },
  windows: "npm install -g opencode-ai",
  unix: "curl -fsSL https://opencode.ai/install | bash",
  page: "https://opencode.ai/download",
  // Windows has no installer of its own (owner): npm or Scoop when one is here, else the command.
  installers: {
    windows: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "opencode-ai"] },
      },
      { needs: "scoop", command: { binary: "scoop", args: ["install", "opencode"] } },
    ],
    unix: [
      {
        needs: "curl",
        command: { binary: "bash", args: ["-c", "curl -fsSL https://opencode.ai/install | bash"] },
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

const tokensSchema = z.looseObject({
  input: z.number(),
  output: z.number(),
  reasoning: z.number().optional(),
  cache: z.looseObject({ read: z.number(), write: z.number() }).optional(),
});
const exportSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      info: z.looseObject({ role: z.string(), tokens: tokensSchema.optional() }),
      parts: z.array(z.looseObject({ type: z.string() })).optional(),
    }),
  ),
});
const childSchema = z.looseObject({
  tool: z.literal("task"),
  state: z.looseObject({ metadata: z.looseObject({ sessionId: z.string().min(1) }) }),
});

// Every model step is its own assistant message, while a turn's ACP result reports only the last
// one, so the whole conversation is read back from its export. Sub-agents ran in sessions of their
// own, named by their task tool calls.
const recount: RecountSupport = {
  command: (conversationId) => ({ binary: "opencode", args: ["export", conversationId] }),
  parse(text) {
    // Anything it logs comes before the JSON.
    const exported = exportSchema.parse(JSON.parse(text.slice(text.indexOf("{"))));
    let input = 0;
    let output = 0;
    let cached = 0;
    const children: string[] = [];
    for (const { info, parts } of exported.messages) {
      if (info.role === "assistant" && info.tokens !== undefined) {
        const { cache, reasoning } = info.tokens;
        input += info.tokens.input + (cache?.read ?? 0) + (cache?.write ?? 0);
        output += info.tokens.output + (reasoning ?? 0);
        cached += cache?.read ?? 0;
      }
      for (const part of parts ?? []) {
        const child = childSchema.safeParse(part);
        if (child.success) children.push(child.data.state.metadata.sessionId);
      }
    }
    return {
      usage: { inputTokens: input, outputTokens: output, cachedInputTokens: cached },
      children,
    };
  },
};

// Each model is a line with its id, then indented JSON; its variants are its effort values.
const catalog: CatalogQuery = {
  command: { binary: "opencode", args: ["models", "--verbose"] },
  read(output) {
    const models = [];
    let id: string | undefined;
    let description: string[] = [];
    for (const line of output) {
      if (id === undefined) {
        if (line.trim() !== "") id = line.trim();
        continue;
      }
      description.push(line);
      if (line !== "}") continue;
      const model = modelSchema.parse(JSON.parse(description.join("")));
      const access = accessOf(model);
      const inputs = inputsOf(model);
      const contextWindow = windowOf(model);
      // A model that cannot call tools, such as one for images or speech, is useless to an agent.
      if (model.capabilities?.toolcall !== false) {
        models.push({
          id,
          name: model.name,
          ...(model.providerID === undefined ? {} : { provider: model.providerID }),
          ...(access === undefined ? {} : { access }),
          efforts: Object.keys(model.variants ?? {}),
          ...(inputs === undefined ? {} : { inputs }),
          ...(contextWindow === undefined ? {} : { contextWindow }),
        });
      }
      id = undefined;
      description = [];
    }
    // It always lists its free models, so an empty list means it failed.
    if (models.length === 0) return undefined;
    const preferred = models.find((model) => model.id === PREFERRED.model);
    if (preferred === undefined) return { models };
    const fallback = {
      ...preferred,
      id: "default",
      name: "Default",
      description: `${preferred.name} · Max thinking`,
      resolvedId: preferred.id,
    };
    return { models: [fallback, ...models] };
  },
};

const configSchema = z.looseObject({
  mcp: z.record(z.string(), z.looseObject({ enabled: z.boolean().optional() })).optional(),
});

// The MCP servers in the user's own OpenCode settings, as OpenCode resolves them; it signs in to
// them and keeps their sign-ins itself. Their tools are known only once an agent uses them.
const vendorApps: VendorAppSupport = {
  command: { binary: "opencode", args: ["debug", "config"] },
  read(output) {
    const text = output.join("\n");
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    const { mcp = {} } = configSchema.parse(JSON.parse(text.slice(start)));
    const apps: VendorApp[] = Object.entries(mcp)
      .filter(([, server]) => server.enabled !== false)
      .map(([name]) => ({ name, id: name, status: "connected", tools: [] }));
    return { apps, pending: false };
  },
};

export const opencodeAdapter = createAcpAdapter({
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
