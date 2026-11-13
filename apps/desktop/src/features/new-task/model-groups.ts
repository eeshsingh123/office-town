import type { HarnessModel } from "@office-town/contract";
import { DEFAULT_MODEL } from "../profiles/model-name.ts";

export interface ModelGroup {
  heading: string;
  models: HarnessModel[];
}

export interface GroupedModels {
  // Recent, free, in the user's plan, and providers used before.
  first: ModelGroup[];
  // Shown on request or when filtering.
  more: ModelGroup[];
}

const RECENT = 5;

// Provider ids as OpenCode lists them; any other reads as its words, "my-proxy" as "My Proxy".
const PROVIDER_NAMES: Record<string, string> = {
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "google-vertex": "Google Vertex",
  huggingface: "Hugging Face",
  openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot",
  deepseek: "DeepSeek",
  xai: "xAI",
};

export function providerName(provider: string): string {
  return (
    PROVIDER_NAMES[provider] ??
    provider
      .split(/[-_]/)
      .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
      .join(" ")
  );
}

// No hand-made list of popular models. Each model is listed once, so the pinned one, shown above
// the groups, is left out of them. A free model offered by two providers (OpenCode Zen and Go) is
// the same to the user, so only its first is listed.
export function groupModels(
  all: readonly HarnessModel[],
  recentIds: readonly string[],
  pinnedId?: string,
): GroupedModels {
  const pinnedName = all.find((model) => model.id === pinnedId)?.name;
  const freeNames = new Set(pinnedName === undefined ? [] : [pinnedName]);
  const sameFree = (model: HarnessModel) => {
    if (model.access !== "free") return false;
    if (freeNames.has(model.name)) return true;
    freeNames.add(model.name);
    return false;
  };
  const byId = new Map(
    all
      .filter((model) => model.id !== DEFAULT_MODEL && model.id !== pinnedId)
      .map((model) => [model.id, model]),
  );
  const recent = recentIds
    .flatMap((id) => byId.get(id) ?? [])
    .filter((model) => !sameFree(model))
    .slice(0, RECENT);
  const models = [...byId.values()].filter((model) => recent.includes(model) || !sameFree(model));
  const listed = new Set(recent.map((model) => model.id));
  const withAccess = (access: HarnessModel["access"]) => {
    const found = models.filter((model) => model.access === access && !listed.has(model.id));
    for (const model of found) listed.add(model.id);
    return found;
  };
  const free = withAccess("free");
  const plan = withAccess("plan");

  const byProvider = new Map<string, HarnessModel[]>();
  for (const model of models) {
    if (listed.has(model.id)) continue;
    const provider = model.provider ?? "";
    const group = byProvider.get(provider) ?? [];
    group.push(model);
    byProvider.set(provider, group);
  }

  const first: ModelGroup[] = [];
  if (recent.length > 0) first.push({ heading: "Recent", models: recent });
  if (free.length > 0) first.push({ heading: "Free", models: free });
  if (plan.length > 0) first.push({ heading: planHeading(plan), models: plan });
  const more: ModelGroup[] = [];
  const used = new Set(recent.map((model) => model.provider ?? ""));
  for (const [provider, list] of byProvider) {
    const group = { heading: provider === "" ? "Models" : providerName(provider), models: list };
    // A harness with one provider has nothing to tuck away.
    if (used.has(provider) || byProvider.size === 1) first.push(group);
    else more.push(group);
  }
  return { first, more };
}

// Names the plan when its models all come from one provider, such as "OpenCode Go plan".
function planHeading(plan: readonly HarnessModel[]): string {
  const providers = new Set(plan.map((model) => model.provider));
  const [only] = providers;
  return providers.size === 1 && only !== undefined ? `${providerName(only)} plan` : "In your plan";
}
