import type { RoleSettings } from "@office-town/contract";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { environmentName } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { ModelPicker } from "../new-task/ModelPicker.tsx";

export type ChipSettings = RoleSettings;

interface SettingsChipsProps {
  value: ChipSettings;
  // Newest first, shown at the top of the model list.
  recentModels?: readonly string[];
  onChange: (next: ChipSettings) => void;
}

// A value no effort can take, since the harness's own words start with a letter or digit.
const DEFAULT_EFFORT = "~default";

// The harness, where it runs, the model and the effort, as chips that each open a list.
export function SettingsChips({ value, recentModels = [], onChange }: SettingsChipsProps) {
  const harnesses = useApp((state) => state.harnesses);
  const description = harnesses.find((known) => known.harness === value.harness) ?? harnesses[0];
  const environments = useLoaded("environments", api.listEnvironments);
  const catalogKey =
    description === undefined || !description.capabilities.modelList
      ? undefined
      : `${description.harness}|${environmentKey(value.environment)}`;
  const catalog = useLoaded(catalogKey, () =>
    readCatalog(description?.harness ?? "", value.environment),
  );
  const models = catalog.value?.models;
  const model = models?.find((known) => known.id === value.model);
  const efforts = description?.capabilities.effort ? (model?.efforts ?? []) : [];
  const environmentChoices = (environments.value ?? [value.environment]).map((environment) => ({
    value: environmentKey(environment),
    label: environmentName(environment),
  }));

  return (
    <>
      <ChoiceMenu
        label="Harness"
        value={description?.harness ?? ""}
        choices={harnesses.map((known) => ({ value: known.harness, label: known.name }))}
        onChange={(harness) => onChange({ harness, environment: value.environment })}
      />
      <ChoiceMenu
        label="Runs on"
        value={environmentKey(value.environment)}
        choices={environmentChoices}
        onChange={(key) => {
          const environment = environments.value?.find((known) => environmentKey(known) === key);
          if (environment !== undefined) onChange({ ...value, environment });
        }}
      />
      {description?.capabilities.modelList ? (
        <ModelPicker
          models={models}
          error={catalog.error}
          value={value.model}
          recent={recentModels}
          onChange={(next) => {
            const nextEfforts = models?.find((known) => known.id === next)?.efforts ?? [];
            const { model: _, effort, ...rest } = value;
            onChange({
              ...rest,
              ...(next === undefined ? {} : { model: next }),
              ...(effort !== undefined && nextEfforts.includes(effort) ? { effort } : {}),
            });
          }}
        />
      ) : null}
      {efforts.length > 0 ? (
        <ChoiceMenu
          label="Effort"
          value={value.effort ?? DEFAULT_EFFORT}
          choices={[
            { value: DEFAULT_EFFORT, label: "Default" },
            ...efforts.map((effort) => ({ value: effort, label: effort })),
          ]}
          onChange={(next) => {
            const { effort: _, ...rest } = value;
            onChange(next === DEFAULT_EFFORT ? rest : { ...rest, effort: next });
          }}
        />
      ) : null}
    </>
  );
}
