import type { HarnessModel } from "@office-town/contract";
import { z } from "zod";
import type { CatalogQuery, HarnessCommand } from "../../adapter.ts";

const optionSchema = z.looseObject({
  id: z.string(),
  category: z.string().optional(),
  currentValue: z.unknown().optional(),
  options: z.array(z.looseObject({ value: z.string(), name: z.string().optional() })).optional(),
});

// A new session names its models as a config option, or in the older `models` list.
const sessionSchema = z.looseObject({
  configOptions: z.array(optionSchema).nullish(),
  models: z
    .looseObject({
      availableModels: z.array(
        z.looseObject({ modelId: z.string(), name: z.string(), description: z.string().nullish() }),
      ),
    })
    .nullish(),
});

const answerSchema = z.looseObject({
  id: z.literal(2),
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});

function modelsOf(result: unknown): HarnessModel[] {
  const session = sessionSchema.parse(result);
  const listed = session.models?.availableModels;
  if (listed !== undefined) {
    return listed.map(({ modelId, name, description }) => ({
      id: modelId,
      name,
      ...(description ? { description } : {}),
      efforts: [],
    }));
  }
  const options = session.configOptions ?? [];
  const model = options.find((option) => option.category === "model" || option.id === "model");
  // The session shows the effort values of its current model only.
  const efforts = (
    options.find((option) => option.category === "thought_level")?.options ?? []
  ).map(({ value }) => value);
  return (model?.options ?? []).map(({ value, name }) => ({
    id: value,
    name: name ?? value,
    efforts: value === model?.currentValue ? efforts : [],
  }));
}

// The models of a harness whose own list needs a sign-in: an empty session it opens shows them.
// "/" is a folder every system has, as the session never does anything.
export function acpCatalog(command: HarnessCommand): CatalogQuery {
  const clientCapabilities = { fs: { readTextFile: false, writeTextFile: false }, terminal: false };
  return {
    command,
    server: true,
    input: [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1, clientCapabilities },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/", mcpServers: [] },
      }),
    ],
    read(output) {
      for (const line of output) {
        if (!line.startsWith("{")) continue;
        const answer = answerSchema.safeParse(JSON.parse(line));
        if (!answer.success) continue;
        if (answer.data.error !== undefined) throw new Error(answer.data.error.message);
        return { models: modelsOf(answer.data.result) };
      }
      return undefined;
    },
  };
}
