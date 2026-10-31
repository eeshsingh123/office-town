import {
  type AgentSettings,
  type EnvironmentSpec,
  environmentListSchema,
  type HarnessCatalog,
  type HarnessDescription,
  type HarnessModel,
} from "@office-town/contract";
import { useEffect, useState } from "react";
import { environmentKey, lastCatalog, readCatalog } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { loadLastKnown, saveLastKnown } from "../../api/last-known.ts";
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
  const harness = description?.harness ?? "";
  const catalog = useLoaded(key, () => readCatalog(harness, environment));
  if (catalog.error !== undefined) return { models: undefined, error: catalog.error };
  const known = key === undefined ? undefined : lastCatalog(harness, environment);
  return { models: catalog.value?.models ?? known?.models, error: undefined };
}

const ENVIRONMENTS_NAME = "environments";

const lastEnvironments =
  loadLastKnown(ENVIRONMENTS_NAME, (stored) => environmentListSchema.safeParse(stored).data) ?? [];

export function useEnvironments(): readonly EnvironmentSpec[] {
  const loaded = useLoaded(ENVIRONMENTS_NAME, async () => {
    const environments = await api.listEnvironments();
    saveLastKnown(ENVIRONMENTS_NAME, environments);
    return environments;
  });
  return loaded.value ?? lastEnvironments;
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
  return (settings) =>
    (catalogs[catalogKey(settings)] ?? lastCatalog(settings.harness, settings.environment))?.models;
}
