import type { HarnessModel, PermissionMode } from "@office-town/contract";
import { z } from "zod";
import type { CatalogQuery, HarnessCommand, LaunchOptions } from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";

const modelSchema = z.looseObject({
  name: z.string(),
  providerID: z.string().min(1).optional(),
  cost: z.looseObject({ input: z.number(), output: z.number() }).optional(),
  capabilities: z.looseObject({ toolcall: z.boolean() }).optional(),
  variants: z.record(z.string(), z.unknown()).optional(),
});
type Model = z.infer<typeof modelSchema>;

// OpenCode Go is OpenCode's own subscription; its models list a price but cost nothing beyond it.
const PLAN_PROVIDER = "opencode-go";

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

// ACP's additionalDirectories is not offered by OpenCode 1.18, so additional folders are opened
// through its own rule for folders outside the workspace.
function externalFolders(paths: string[] | undefined) {
  if (paths === undefined || paths.length === 0) return {};
  const rules = paths.map((path) => {
    const separator = path.includes("\\") ? "\\" : "/";
    return [`${path.replace(/[\\/]+$/, "")}${separator}*`, "allow"];
  });
  return { external_directory: Object.fromEntries(rules) };
}

function buildCommand(options: LaunchOptions): HarnessCommand {
  // The core's own tools never ask, even under a user's stricter rules: what they lead to is
  // guarded where it happens.
  const toolRules = options.toolServers.map((server) => [`${server.name}_*`, "allow"]);
  // OpenCode merges this inline config over the user's own, so nothing on disk is touched.
  const config = {
    permission: {
      ...PERMISSIONS[options.permissionMode],
      ...externalFolders(options.additionalPaths),
      ...Object.fromEntries(toolRules),
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  return {
    binary: "opencode",
    args: ["acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  };
}

// The CLI prints each model as a line with its id followed by an indented JSON description.
// What OpenCode calls a model's variants are its effort values.
const catalog: CatalogQuery = {
  command: { binary: "opencode", args: ["models", "--verbose"] },
  input: [],
  parse(output) {
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
      // An agent works by calling tools, so a model that cannot, such as one for images or
      // speech, is left out.
      if (model.capabilities?.toolcall !== false) {
        models.push({
          id,
          name: model.name,
          ...(model.providerID === undefined ? {} : { provider: model.providerID }),
          ...(access === undefined ? {} : { access }),
          efforts: Object.keys(model.variants ?? {}),
        });
      }
      id = undefined;
      description = [];
    }
    return { models };
  },
};

export const opencodeAdapter = createAcpAdapter({
  harness: "opencode",
  name: "OpenCode",
  capabilities: {
    reasoning: true,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: false,
  },
  catalog,
  buildCommand,
});
