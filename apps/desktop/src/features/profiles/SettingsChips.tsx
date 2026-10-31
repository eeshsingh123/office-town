import type { RoleSettings } from "@office-town/contract";
import { environmentKey } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { environmentName } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { ModelPicker } from "../new-task/ModelPicker.tsx";
import { useOfferedHarnesses } from "../providers/providers.ts";
import { fullest, percent, roomiest, sameEnvironment } from "../usage/limits.ts";
import { useCatalog } from "./model-line.ts";
import { effortsOf } from "./model-name.ts";

export type ChipSettings = RoleSettings;

interface SettingsChipsProps {
  value: ChipSettings;
  // Newest first, shown at the top of the model list.
  recentModels?: readonly string[];
  // Off where the page already offers the AI apps as larger choices.
  showHarness?: boolean;
  onChange: (next: ChipSettings) => void;
}

// No effort can take this, since the harness's own words start with a letter or digit.
const DEFAULT_EFFORT = "~default";
const AUTOMATIC = "~automatic";

// Shown once there is more than one account to pick from (D-61).
function AccountChip({
  value,
  onChange,
}: {
  value: ChipSettings;
  onChange: (next: ChipSettings) => void;
}) {
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const mine = accounts.filter(
    (account) =>
      account.harness === value.harness && sameEnvironment(account.environment, value.environment),
  );
  if (mine.length < 2) return null;
  const room = (accountId: string) => {
    const full = fullest(limits[accountId]);
    if (full === undefined) return undefined;
    return full.usedFraction >= 1 ? "At its limit" : `${percent(full.usedFraction)} used`;
  };
  const best = roomiest(mine, limits);
  return (
    <ChoiceMenu
      label="Account"
      value={value.accountId ?? AUTOMATIC}
      choices={[
        {
          value: AUTOMATIC,
          label: "Automatic",
          ...(best === undefined
            ? {}
            : { description: `The one with the most room, now ${best.name}` }),
        },
        ...mine.map((account) => {
          const description = room(account.id);
          return {
            value: account.id,
            label: account.name,
            ...(description === undefined ? {} : { description }),
          };
        }),
      ]}
      onChange={(next) => {
        const { accountId: _, ...rest } = value;
        onChange(next === AUTOMATIC ? rest : { ...rest, accountId: next });
      }}
    />
  );
}

export function SettingsChips({
  value,
  recentModels = [],
  showHarness = true,
  onChange,
}: SettingsChipsProps) {
  const harnesses = useOfferedHarnesses(value.harness, value.environment);
  const description = harnesses.find((known) => known.harness === value.harness) ?? harnesses[0];
  const environments = useLoaded("environments", api.listEnvironments);
  const catalog = useCatalog(description, value.environment);
  const models = catalog.models;
  const efforts = description?.capabilities.effort ? effortsOf(models, value.model) : [];
  const environmentChoices = (environments.value ?? [value.environment]).map((environment) => ({
    value: environmentKey(environment),
    label: environmentName(environment),
  }));

  return (
    <>
      {showHarness ? (
        <ChoiceMenu
          label="AI app"
          value={description?.harness ?? ""}
          choices={harnesses.map((known) => ({ value: known.harness, label: known.name }))}
          onChange={(harness) => onChange({ harness, environment: value.environment })}
        />
      ) : null}
      <ChoiceMenu
        label="Runs on"
        value={environmentKey(value.environment)}
        choices={environmentChoices}
        onChange={(key) => {
          const environment = environments.value?.find((known) => environmentKey(known) === key);
          if (environment === undefined) return;
          // An account belongs to where it runs.
          const { accountId: _, ...rest } = value;
          onChange({ ...rest, environment });
        }}
      />
      <AccountChip value={value} onChange={onChange} />
      {description?.capabilities.modelList ? (
        <ModelPicker
          models={models}
          error={catalog.error}
          value={value.model}
          recent={recentModels}
          onChange={(next) => {
            const nextEfforts = effortsOf(models, next);
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
          label="Thinking"
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
