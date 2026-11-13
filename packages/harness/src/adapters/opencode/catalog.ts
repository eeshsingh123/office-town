import type { HarnessCatalog, HarnessModel } from "@office-town/contract";
import { z } from "zod";
import type { CatalogQuery } from "../../adapter.ts";

// OpenCode Go is OpenCode's own subscription; its models list a price but cost nothing beyond it.
const PLAN_PROVIDER = "opencode-go";

// OpenCode does not say what it would run, so the app names its default itself: free, and thinking
// as hard as it can. Free models come and go, so this applies only while OpenCode lists it.
export const PREFERRED = { model: "opencode/deepseek-v4.1-flash-free", effort: "max" };

// What both OpenCode releases say about a model, in their own shapes.
interface Listed {
  id: string;
  name: string;
  provider?: string;
  cost?: { input: number; output: number };
  tools?: boolean;
  image?: boolean;
  pdf?: boolean;
  efforts: string[];
  limit?: { context?: number | undefined; input?: number | undefined };
}

function accessOf({ cost, provider }: Listed): HarnessModel["access"] {
  if (cost === undefined) return undefined;
  if (cost.input === 0 && cost.output === 0) return "free";
  return provider === PLAN_PROVIDER ? "plan" : "paid";
}

// OpenCode compacts against what a model can take in, which some models list below their window.
function windowOf({ limit }: Listed): number | undefined {
  const window = [limit?.input, limit?.context].find((size) => size !== undefined && size > 0);
  return window === undefined ? undefined : Math.floor(window);
}

function toModel(listed: Listed): HarnessModel {
  const access = accessOf(listed);
  const contextWindow = windowOf(listed);
  const inputs =
    listed.image === undefined && listed.pdf === undefined
      ? undefined
      : [...(listed.image ? ["image" as const] : []), ...(listed.pdf ? ["pdf" as const] : [])];
  return {
    id: listed.id,
    name: listed.name,
    ...(listed.provider === undefined ? {} : { provider: listed.provider }),
    ...(access === undefined ? {} : { access }),
    efforts: listed.efforts,
    ...(inputs === undefined ? {} : { inputs }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

// A model that cannot call tools, such as one for images or speech, is useless to an agent. It
// always lists its free models, so an empty list means it failed.
function catalogOf(listed: Listed[]): HarnessCatalog | undefined {
  const models = listed.filter((model) => model.tools !== false).map(toModel);
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
}

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

// OpenCode 1: each model is a line with its id, then indented JSON; its variants are its efforts.
export const catalog: CatalogQuery = {
  command: { binary: "opencode", args: ["models", "--verbose"] },
  read(output) {
    const listed: Listed[] = [];
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
      listed.push({
        id,
        name: model.name,
        ...(model.providerID === undefined ? {} : { provider: model.providerID }),
        ...(model.cost === undefined ? {} : { cost: model.cost }),
        ...(model.capabilities === undefined ? {} : { tools: model.capabilities.toolcall }),
        ...(model.capabilities?.input === undefined
          ? {}
          : { image: model.capabilities.input.image, pdf: model.capabilities.input.pdf }),
        efforts: Object.keys(model.variants ?? {}),
        ...(model.limit === undefined ? {} : { limit: model.limit }),
      });
      id = undefined;
      description = [];
    }
    return catalogOf(listed);
  },
};

const listSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      providerID: z.string().min(1),
      name: z.string(),
      enabled: z.boolean().optional(),
      cost: z.array(z.looseObject({ input: z.number(), output: z.number() })).optional(),
      capabilities: z
        .looseObject({ tools: z.boolean(), input: z.array(z.string()) })
        .partial()
        .optional(),
      variants: z.array(z.looseObject({ id: z.string() })).optional(),
      limit: z.looseObject({ context: z.number(), input: z.number() }).partial().optional(),
    }),
  ),
});

// OpenCode 2 lists its models in detail only through its API. A private server, so the call
// neither starts nor reaches the user's background one (D-97).
export const catalog2: CatalogQuery = {
  command: { binary: "opencode", args: ["api", "model.list", "--standalone"] },
  read(output) {
    const text = output.join("\n");
    const start = text.indexOf("{");
    if (start === -1) return undefined;
    const { data } = listSchema.parse(JSON.parse(text.slice(start)));
    const listed = data
      .filter((model) => model.enabled !== false)
      .map((model): Listed => {
        const input = model.capabilities?.input;
        // Longer prompts may cost more; the first price is the usual one.
        const cost = model.cost?.[0];
        return {
          id: `${model.providerID}/${model.id}`,
          name: model.name,
          provider: model.providerID,
          ...(cost === undefined ? {} : { cost }),
          ...(model.capabilities?.tools === undefined ? {} : { tools: model.capabilities.tools }),
          ...(input === undefined
            ? {}
            : { image: input.includes("image"), pdf: input.includes("pdf") }),
          efforts: (model.variants ?? []).map((variant) => variant.id),
          ...(model.limit === undefined ? {} : { limit: model.limit }),
        };
      });
    return catalogOf(listed);
  },
};
