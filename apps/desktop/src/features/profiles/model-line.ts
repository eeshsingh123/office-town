import type {
  AgentSettings,
  HarnessCatalog,
  HarnessDescription,
  HarnessModel,
} from "@office-town/contract";
import { useEffect, useState } from "react";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { useApp } from "../../store/app-store.ts";
import { useLoaded } from "../../ui/use-loaded.ts";

type Settings = Pick<AgentSettings, "harness" | "environment" | "model" | "effort">;

const catalogKey = (settings: Settings) =>
  `${settings.harness}|${environmentKey(settings.environment)}`;

// Such as "Sonnet 5.5 · Claude Code · Medium effort": the model's full name from the AI app's
// own list, then the app, then the effort if one is set.
export function modelLine(
  settings: Settings,
  harnesses: readonly HarnessDescription[],
  model: HarnessModel | undefined,
): string {
  const app = harnesses.find((known) => known.harness === settings.harness)?.name;
  const effort = settings.effort;
  return [
    model?.name ?? settings.model ?? "Default model",
    app ?? settings.harness,
    effort === undefined ? undefined : `${effort[0]?.toUpperCase()}${effort.slice(1)} effort`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

export function modelName(settings: Settings, model: HarnessModel | undefined): string {
  return model?.name ?? settings.model ?? "Default model";
}

export function useModelLine(settings: Settings | undefined): string {
  const harnesses = useApp((state) => state.harnesses);
  const description = harnesses.find((known) => known.harness === settings?.harness);
  const catalog = useLoaded(
    settings !== undefined && description?.capabilities.modelList
      ? catalogKey(settings)
      : undefined,
    () => readCatalog(settings?.harness ?? "", settings?.environment ?? { kind: "native" }),
  );
  if (settings === undefined) return "";
  return modelLine(
    settings,
    harnesses,
    catalog.value?.models.find((known) => known.id === settings.model),
  );
}

// The model of each one, for a list of many, reading each AI app's model list once.
export function useModels(
  list: readonly Settings[],
): (settings: Settings) => HarnessModel | undefined {
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
    catalogs[catalogKey(settings)]?.models.find((known) => known.id === settings.model);
}
