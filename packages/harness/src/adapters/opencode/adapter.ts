import type { PermissionMode } from "@office-town/contract";
import { z } from "zod";
import type { CatalogQuery, HarnessCommand, LaunchOptions } from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";

const modelSchema = z.looseObject({
  name: z.string(),
  variants: z.record(z.string(), z.unknown()).optional(),
});

type Rule = "ask" | "allow";

const PERMISSIONS: Record<PermissionMode, { edit: Rule; bash: Rule; webfetch: Rule }> = {
  ask: { edit: "ask", bash: "ask", webfetch: "ask" },
  acceptEdits: { edit: "allow", bash: "ask", webfetch: "ask" },
  bypass: { edit: "allow", bash: "allow", webfetch: "allow" },
};

function buildCommand(options: LaunchOptions): HarnessCommand {
  // OpenCode merges this inline config over the user's own, so nothing on disk is touched.
  const config = {
    permission: PERMISSIONS[options.permissionMode],
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
      models.push({ id, name: model.name, efforts: Object.keys(model.variants ?? {}) });
      id = undefined;
      description = [];
    }
    return { models };
  },
};

export const opencodeAdapter = createAcpAdapter({
  harness: "opencode",
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
