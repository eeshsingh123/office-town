import type { RoleSettings } from "@office-town/contract";
import { readCatalog } from "../../api/catalogs.ts";
import { modelName } from "../profiles/model-name.ts";

export interface TutorialModel {
  settings: RoleSettings;
  // Unset when the provider runs its own default model.
  name?: string;
  free: boolean;
}

const NATIVE = { kind: "native" } as const;
const FREE_MODEL = "opencode/big-pickle";

async function opencodeFree(): Promise<TutorialModel | undefined> {
  const opencode = await readCatalog("opencode", NATIVE).catch(() => undefined);
  const free =
    opencode?.models.find((model) => model.id === FREE_MODEL) ??
    opencode?.models.find((model) => model.access === "free");
  if (opencode === undefined || free === undefined) return undefined;
  return {
    settings: { harness: "opencode", environment: NATIVE, model: free.id },
    name: modelName(opencode.models, free.id) ?? free.name,
    free: true,
  };
}

async function claudeHaiku(): Promise<TutorialModel | undefined> {
  const claude = await readCatalog("claude", NATIVE).catch(() => undefined);
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

// Tutorials run on the cheapest model at hand: on the provider the user picked in setup, else
// OpenCode's free one, else Haiku on low effort. Other providers run their own default.
export async function findTutorialModel(harness?: string): Promise<TutorialModel | undefined> {
  if (harness === "opencode") return opencodeFree();
  if (harness === "claude") return claudeHaiku();
  if (harness !== undefined) return { settings: { harness, environment: NATIVE }, free: false };
  // Read together, and usually already loaded when the app opened (store/live.ts).
  const [free, haiku] = await Promise.all([opencodeFree(), claudeHaiku()]);
  return free ?? haiku;
}
