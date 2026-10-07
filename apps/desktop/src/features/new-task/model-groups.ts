import type { HarnessModel } from "@office-town/contract";

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

// No hand-made list of popular models. Each model is listed once.
export function groupModels(
  models: readonly HarnessModel[],
  recentIds: readonly string[],
): GroupedModels {
  const byId = new Map(models.map((model) => [model.id, model]));
  const recent = recentIds.flatMap((id) => byId.get(id) ?? []).slice(0, RECENT);
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
  if (plan.length > 0) first.push({ heading: "In your plan", models: plan });
  const more: ModelGroup[] = [];
  const used = new Set(recent.map((model) => model.provider ?? ""));
  for (const [provider, list] of byProvider) {
    const group = { heading: provider === "" ? "Models" : provider, models: list };
    // A harness with one provider has nothing to tuck away.
    if (used.has(provider) || byProvider.size === 1) first.push(group);
    else more.push(group);
  }
  return { first, more };
}
