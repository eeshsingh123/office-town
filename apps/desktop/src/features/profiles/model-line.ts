import type {
  AgentSettings,
  EnvironmentSpec,
  HarnessCatalog,
  HarnessDescription,
  HarnessModel,
} from "@office-town/contract";
import { useEffect, useState } from "react";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { useApp } from "../../store/app-store.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { modelLine, modelName } from "./model-name.ts";

type Settings = Pick<AgentSettings, "harness" | "environment" | "model" | "effort">;

const catalogKey = (settings: Pick<Settings, "harness" | "environment">) =>
  `${settings.harness}|${environmentKey(settings.environment)}`;

export function useCatalog(
  description: HarnessDescription | undefined,
  environment: EnvironmentSpec,
): { models: readonly HarnessModel[] | undefined; error: string | undefined } {
  const key =
    description === undefined || !description.capabilities.modelList
      ? undefined
      : catalogKey({ harness: description.harness, environment });
  const catalog = useLoaded(key, () => readCatalog(description?.harness ?? "", environment));
  return { models: catalog.value?.models, error: catalog.error };
}

function useModelsOf(settings: Pick<Settings, "harness" | "environment"> | undefined) {
  const harnesses = useApp((state) => state.harnesses);
  const description = harnesses.find((known) => known.harness === settings?.harness);
  return useCatalog(description, settings?.environment ?? { kind: "native" }).models;
}

export function useModelName(
  settings: Pick<Settings, "harness" | "environment"> | undefined,
  id: string | undefined,
): string {
  return modelName(useModelsOf(settings), id) ?? "Default model";
}

export function useModelLine(settings: Settings | undefined): string {
  const harnesses = useApp((state) => state.harnesses);
  const models = useModelsOf(settings);
  return settings === undefined ? "" : modelLine(settings, harnesses, models);
}

// The models of each one, for a list of many, reading each AI app's model list once.
export function useModels(
  list: readonly Settings[],
): (settings: Settings) => readonly HarnessModel[] | undefined {
  const harnesses = useApp((state) => state.harnesses);
  const [catalogs, setCatalogs] = useState<Record<string, HarnessCatalog>>({});
  const wanted = [
    ...new Set(
      list
        .filter(
          (settings) =>
            harnesses.find((known) => known.harness === settings.harness)?.capabilities.modelList,
        )
        .map(catalogKey),
    ),
  ].join(",");
  useEffect(() => {
    let current = true;
    for (const key of wanted.split(",").filter((part) => part !== "")) {
      const [harness = "", where = "native"] = key.split("|");
      const environment = where.startsWith("wsl:")
        ? { kind: "wsl" as const, distro: where.slice("wsl:".length) }
        : { kind: "native" as const };
      readCatalog(harness, environment)
        .then((catalog) => {
          if (current) setCatalogs((known) => ({ ...known, [key]: catalog }));
        })
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [wanted]);
  return (settings) => catalogs[catalogKey(settings)]?.models;
}
