import type { RoleSettings } from "@office-town/contract";
import { ChevronDown, Plus, Sparkles } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { environmentKey } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { environmentName } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { useCatalog } from "../profiles/model-line.ts";
import { DEFAULT_MODEL, modelName } from "../profiles/model-name.ts";
import { useOfferedHarnesses } from "../providers/providers.ts";
import styles from "./Composer.module.css";
import { ModelList } from "./ModelList.tsx";

const EFFORT_NAMES: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

// The harness's own word when it has one we don't know.
export const effortName = (effort: string) =>
  EFFORT_NAMES[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);

interface ModelChipProps {
  value: RoleSettings;
  // Newest first.
  recent: readonly string[];
  onChange: (next: RoleSettings) => void;
}

// The AI app, the model, how hard it thinks and where it runs, in one menu.
export function ModelChip({ value, recent, onChange }: ModelChipProps) {
  const description = useApp((state) =>
    state.harnesses.find((known) => known.harness === value.harness),
  );
  // Only the apps ready here, and the one already picked (D-76).
  const harnesses = useOfferedHarnesses(value.harness);
  const environments = useLoaded("environments", api.listEnvironments).value ?? [];
  const { models, error } = useCatalog(description, value.environment);
  const [open, setOpen] = useState(false);
  const listsModels = description?.capabilities.modelList === true;
  const current = models?.find((known) => known.id === (value.model ?? DEFAULT_MODEL));
  const efforts = description?.capabilities.effort ? (current?.efforts ?? []) : [];
  const name = listsModels
    ? (modelName(models, value.model) ?? "Default model")
    : (description?.name ?? value.harness);

  const chooseModel = (model: string | undefined) => {
    const nextEfforts =
      models?.find((known) => known.id === (model ?? DEFAULT_MODEL))?.efforts ?? [];
    const { model: _, effort, ...rest } = value;
    onChange({
      ...rest,
      ...(model === undefined ? {} : { model }),
      ...(effort !== undefined && nextEfforts.includes(effort) ? { effort } : {}),
    });
    setOpen(false);
  };
  const chooseEffort = (effort: string | undefined) => {
    const { effort: _, ...rest } = value;
    onChange(effort === undefined ? rest : { ...rest, effort });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={styles.chip} aria-label={`Model: ${name}`}>
        <Sparkles size={14} aria-hidden />
        <span className={styles.chipText}>{name}</span>
        {value.effort === undefined ? null : (
          <span className={styles.chipMuted}>· {effortName(value.effort)}</span>
        )}
        <ChevronDown size={13} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.modelMenu}`}
          align="start"
          sideOffset={6}
        >
          {harnesses.length > 1 ? (
            <div className={styles.menuRow}>
              <span className={styles.rowLabel}>AI app</span>
              <Segments
                label="AI app"
                value={value.harness}
                options={harnesses.map((known) => ({ value: known.harness, label: known.name }))}
                onChange={(harness) => onChange({ harness, environment: value.environment })}
              />
            </div>
          ) : null}
          {!listsModels ? null : error !== undefined ? (
            <p className={styles.menuNote}>Could not read the models: {error}</p>
          ) : models === undefined ? (
            <p className={styles.menuNote}>Reading the models…</p>
          ) : (
            <ModelList models={models} value={value.model} recent={recent} onChoose={chooseModel} />
          )}
          {efforts.length > 0 ? (
            <div className={`${styles.menuRow} ${styles.menuFoot}`}>
              <span className={styles.rowLabel}>Thinking</span>
              <Segments
                label="Thinking"
                value={value.effort ?? ""}
                options={[
                  { value: "", label: "Default" },
                  ...efforts.map((effort) => ({ value: effort, label: effortName(effort) })),
                ]}
                onChange={(effort) => chooseEffort(effort === "" ? undefined : effort)}
              />
            </div>
          ) : null}
          {environments.length > 1 ? (
            <div className={`${styles.menuRow} ${styles.menuFoot}`}>
              <span className={styles.rowLabel}>Runs on</span>
              <Segments
                label="Runs on"
                value={environmentKey(value.environment)}
                options={environments.map((environment) => ({
                  value: environmentKey(environment),
                  label: environmentName(environment),
                }))}
                onChange={(key) => {
                  const environment = environments.find((known) => environmentKey(known) === key);
                  if (environment !== undefined) onChange({ ...value, environment });
                }}
              />
            </div>
          ) : null}
          <div className={styles.menuFoot}>
            <button
              type="button"
              className={`${menu.item} ${styles.getMore}`}
              onClick={() => {
                setOpen(false);
                navigate({ name: "providers" });
              }}
            >
              <Plus size={14} aria-hidden />
              Get more AI apps
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Segments(props: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className={styles.segments}>
      <legend className="visually-hidden">{props.label}</legend>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
