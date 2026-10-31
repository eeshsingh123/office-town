import type { HarnessDescription, RoleSettings } from "@office-town/contract";
import { ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { type ReactNode, useState } from "react";
import { environmentKey } from "../../api/catalogs.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { environmentName } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { useCatalog, useEnvironments, useModels } from "../profiles/model-line.ts";
import { accessNote, effortLabel, effortsOf, modelName } from "../profiles/model-name.ts";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { useOfferedHarnesses } from "../providers/providers.ts";
import styles from "./Composer.module.css";
import { ModelList } from "./ModelList.tsx";

interface ModelChipProps {
  value: RoleSettings;
  // Newest first.
  recent: readonly string[];
  onChange: (next: RoleSettings) => void;
  // On a running agent: it stays on its machine, and the picks wait for the footer's Apply.
  draft?: { footer: (close: () => void) => ReactNode; onDiscard: () => void } | undefined;
  triggerClassName?: string | undefined;
}

// A part of its own so the other AI apps' model lists are read only once the menu opens.
function AppRows({
  harnesses,
  value,
  onPick,
}: {
  harnesses: readonly HarnessDescription[];
  value: RoleSettings;
  onPick: (harness: string) => void;
}) {
  const { environment } = value;
  const modelsOf = useModels(harnesses.map(({ harness }) => ({ harness, environment })));
  return harnesses.map(({ harness, name }) => {
    const note = accessNote(modelsOf({ harness, environment }));
    return (
      <button
        key={harness}
        type="button"
        className={`${menu.item} ${styles.appRow}`}
        aria-pressed={harness === value.harness}
        onClick={() => onPick(harness)}
      >
        <ProviderLogo harness={harness} size="sm" />
        <span className={menu.itemText}>
          <span className={styles.appName}>{name}</span>
          {note === undefined ? null : <span className={menu.itemDescription}>{note}</span>}
        </span>
      </button>
    );
  });
}

// The one way to pick an AI app, its model, how hard it thinks and where it runs.
export function ModelChip({
  value,
  recent,
  onChange,
  draft,
  triggerClassName = styles.chip,
}: ModelChipProps) {
  const description = useApp((state) =>
    state.harnesses.find((known) => known.harness === value.harness),
  );
  // Only the apps ready here, and the one already picked (D-76).
  const { offered, checking } = useOfferedHarnesses(value.harness, value.environment);
  const environments = useEnvironments();
  const { models, error } = useCatalog(description, value.environment);
  const [open, setOpen] = useState(false);
  const listsModels = description?.capabilities.modelList === true;
  const efforts = description?.capabilities.effort ? effortsOf(models, value.model) : [];
  const name = listsModels
    ? (modelName(models, value.model) ?? "Default model")
    : (description?.name ?? value.harness);
  const thinking =
    value.effort !== undefined
      ? effortLabel(value.effort)
      : draft === undefined
        ? undefined
        : "Default";

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) draft?.onDiscard();
  };
  // A model and an account belong to their AI app, so only where it runs carries over.
  const chooseApp = (harness: string) => {
    if (harness !== value.harness) onChange({ harness, environment: value.environment });
  };
  const chooseModel = (model: string | undefined) => {
    const nextEfforts = description?.capabilities.effort ? effortsOf(models, model) : [];
    const { model: _, effort, ...rest } = value;
    onChange({
      ...rest,
      ...(model === undefined ? {} : { model }),
      ...(effort !== undefined && nextEfforts.includes(effort) ? { effort } : {}),
    });
    // Open while its thinking is still to pick, so one visit sets both.
    if (nextEfforts.length === 0 && draft === undefined) setOpen(false);
  };
  const chooseEffort = (effort: string | undefined) => {
    const { effort: _, ...rest } = value;
    onChange(effort === undefined ? rest : { ...rest, effort });
  };
  const chooseEnvironment = (key: string) => {
    const environment = environments.find((known) => environmentKey(known) === key);
    if (environment === undefined) return;
    // An account belongs to where it runs.
    const { accountId: _, ...rest } = value;
    onChange({ ...rest, environment });
  };

  return (
    // Modal, so the list still scrolls inside a dialog, whose scroll lock would cancel the wheel.
    <Popover.Root modal open={open} onOpenChange={changeOpen}>
      <Popover.Trigger className={triggerClassName} aria-label={`Model: ${name}`}>
        {draft === undefined ? <ProviderLogo harness={value.harness} size="sm" /> : null}
        <span className={styles.chipText}>{name}</span>
        {thinking === undefined ? null : <span className={styles.chipMuted}>· {thinking}</span>}
        <ChevronDown size={13} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.modelMenu}`}
          align="start"
          sideOffset={6}
        >
          <div className={styles.menuPanes}>
            <div className={styles.menuApps}>
              <span className={styles.rowLabel}>AI app</span>
              <AppRows harnesses={offered} value={value} onPick={chooseApp} />
              {checking ? (
                <span className={styles.menuChecking} role="status">
                  <LoaderCircle size={14} className="spin" aria-hidden />
                  Checking AI apps…
                </span>
              ) : null}
              {draft === undefined ? (
                <button
                  type="button"
                  className={`${menu.item} ${styles.getMore}`}
                  onClick={() => {
                    setOpen(false);
                    navigate({ name: "providers" });
                  }}
                >
                  <Plus size={14} aria-hidden />
                  Providers
                </button>
              ) : null}
            </div>
            <div className={styles.menuModels}>
              {!listsModels ? null : error !== undefined ? (
                <p className={styles.menuNote}>Could not read the models: {error}</p>
              ) : models === undefined ? (
                <p className={styles.menuNote} role="status">
                  <LoaderCircle size={14} className="spin" aria-hidden />
                  Reading the models…
                </p>
              ) : (
                <ModelList
                  key={value.harness}
                  models={models}
                  value={value.model}
                  recent={recent}
                  onChoose={chooseModel}
                />
              )}
              {models === undefined ? null : (
                <div className={styles.menuThinking}>
                  <span className={styles.rowLabel}>Thinking</span>
                  {efforts.length > 0 ? (
                    <Segments
                      label="Thinking"
                      value={value.effort ?? ""}
                      options={[
                        { value: "", label: "Default" },
                        ...efforts.map((effort) => ({ value: effort, label: effortLabel(effort) })),
                      ]}
                      onChange={(effort) => chooseEffort(effort === "" ? undefined : effort)}
                    />
                  ) : (
                    <span className={styles.oneSetting}>This model has one setting</span>
                  )}
                </div>
              )}
            </div>
          </div>
          {environments.length > 1 && draft === undefined ? (
            <div className={`${styles.menuRow} ${styles.menuFoot}`}>
              <span className={styles.rowLabel}>Runs on</span>
              <Segments
                label="Runs on"
                value={environmentKey(value.environment)}
                options={environments.map((environment) => ({
                  value: environmentKey(environment),
                  label: environmentName(environment),
                }))}
                onChange={chooseEnvironment}
              />
            </div>
          ) : null}
          {draft?.footer(() => changeOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Segments(props: {
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
