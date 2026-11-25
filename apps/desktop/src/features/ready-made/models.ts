import type { HarnessModel, RoleSettings } from "@office-town/contract";
import { useEffect } from "react";
import { lastCatalog, readCatalog } from "../../api/catalogs.ts";
import { useApp } from "../../store/app-store.ts";
import { FREE_PROVIDER, isReady, useHarnessStatuses } from "../providers/providers.ts";

// How much a role needs, never a model name: those go stale in weeks (D-136).
export type Power = "strong" | "cheap";

const NATIVE = { kind: "native" } as const;
// Paid plans first, so a strong role uses the user's best subscription.
const STRONG_ORDER = ["claude", "codex", "copilot", "cursor", "muse"];

export type PowerSettings = Record<Power, RoleSettings>;

// The providers that can run a task now, strongest first; empty while they are still checked.
export function useReadyHarnesses(): string[] {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  const ready = harnesses
    .map(({ harness }) => harness)
    .filter((harness) => isReady(statuses?.[harness]));
  const rank = (harness: string) => {
    const at = STRONG_ORDER.indexOf(harness);
    return at === -1 ? (harness === FREE_PROVIDER ? 99 : 50) : at;
  };
  ready.sort((a, b) => rank(a) - rank(b));
  // A catalog takes seconds to read, so it starts with the page and a pick finds it ready. Only
  // the ones a pick reads: the strongest, Claude for its apps, and the free provider.
  const used = ready.filter(
    (harness, at) => at === 0 || harness === "claude" || harness === FREE_PROVIDER,
  );
  const key = used.join(",");
  useEffect(() => {
    for (const harness of key.split(",").filter(Boolean)) void catalogOf(harness);
  }, [key]);
  return ready;
}

// A catalog that cannot be read leaves the role on the app's own default model.
const catalogOf = async (harness: string) =>
  (lastCatalog(harness, NATIVE) ?? (await readCatalog(harness, NATIVE).catch(() => undefined)))
    ?.models ?? [];

const settingsWith = (harness: string, model: HarnessModel | undefined): RoleSettings => ({
  harness,
  environment: NATIVE,
  ...(model === undefined ? {} : { model: model.id }),
});

// Strong goes to the best paid provider (Opus on Claude, else its own default); cheap to OpenCode's
// free model when it is ready, so one team can span providers at no cost, else the cheapest there.
export async function powerSettings(ready: string[], fallback: string): Promise<PowerSettings> {
  const top = ready[0] ?? fallback;
  const topModels = await catalogOf(top);
  const strong = top === "claude" ? topModels.find((model) => model.id === "opus") : undefined;
  const free = ready.includes(FREE_PROVIDER)
    ? (await catalogOf(FREE_PROVIDER)).find((model) => model.access === "free")
    : undefined;
  const cheapHere =
    topModels.find((model) => model.access === "free") ??
    topModels.find((model) => model.id === "haiku");
  return {
    strong: settingsWith(top, strong),
    cheap: free === undefined ? settingsWith(top, cheapHere) : settingsWith(FREE_PROVIDER, free),
  };
}
