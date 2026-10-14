import type { RoleSettings } from "@office-town/contract";
import { readCatalog } from "../../api/catalogs.ts";
import { modelName } from "../profiles/model-name.ts";

export interface TutorialModel {
  settings: RoleSettings;
  name: string;
  free: boolean;
}

const NATIVE = { kind: "native" } as const;
const FREE_MODEL = "opencode/big-pickle";

// Tutorials run on the cheapest model at hand: OpenCode's free one, else Haiku on low effort.
export async function findTutorialModel(): Promise<TutorialModel | undefined> {
  // Read together, and usually already loaded when the app opened (store/live.ts).
  const [opencode, claude] = await Promise.all([
    readCatalog("opencode", NATIVE).catch(() => undefined),
    readCatalog("claude", NATIVE).catch(() => undefined),
  ]);
  const free =
    opencode?.models.find((model) => model.id === FREE_MODEL) ??
    opencode?.models.find((model) => model.access === "free");
  if (opencode !== undefined && free !== undefined) {
    return {
      settings: { harness: "opencode", environment: NATIVE, model: free.id },
      name: modelName(opencode.models, free.id) ?? free.name,
      free: true,
    };
  }
  const haiku = claude?.models.find((model) => /haiku/i.test(`${model.id} ${model.name}`));
  if (claude === undefined || haiku === undefined) return undefined;
  return {
    settings: {
      harness: "claude",
      environment: NATIVE,
      model: haiku.id,
      ...(haiku.efforts.includes("low") ? { effort: "low" } : {}),
    },
    name: modelName(claude.models, haiku.id) ?? haiku.name,
    free: false,
  };
}
