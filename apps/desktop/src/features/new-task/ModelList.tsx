import type { HarnessModel } from "@office-town/contract";
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import menu from "../../ui/Menu.module.css";
import { DEFAULT_MODEL, findModel, modelName } from "../profiles/model-name.ts";
import styles from "./ModelPicker.module.css";
import { groupModels } from "./model-groups.ts";

interface ModelListProps {
  models: readonly HarnessModel[];
  value: string | undefined;
  // Newest first.
  recent: readonly string[];
  onChoose: (model: string | undefined) => void;
}

// No model id can take these, since an id must start with a letter or digit.
const DEFAULT_VALUE = "~default";
const MORE_VALUE = "~more";
// Enough for the current models of a harness; older ones wait behind "more".
const SHOWN = 8;

const rowClass = (picked: boolean) => `${menu.item} ${styles.model} ${picked ? styles.picked : ""}`;

// A model the AI app no longer lists still shows, as the chip names it too.
function pinnedModel(models: readonly HarnessModel[], value: string | undefined) {
  if (value === undefined || value === DEFAULT_MODEL) return undefined;
  const name = modelName(models, value) ?? value;
  return findModel(models, value) ?? { id: value, name, efforts: [] };
}

function ModelRow(props: {
  model: HarnessModel;
  picked: boolean;
  keywords: string[];
  onChoose: (model: string) => void;
}) {
  const { model, picked, keywords, onChoose } = props;
  return (
    <Command.Item
      value={model.id}
      keywords={keywords}
      className={rowClass(picked)}
      onSelect={() => onChoose(model.id)}
    >
      <span className={menu.itemText}>
        <span className={styles.modelName}>{model.name}</span>
        {model.description === undefined ? null : (
          <span className={menu.itemDescription}>{model.description}</span>
        )}
      </span>
      {model.access === "free" ? <span className={styles.free}>Free</span> : null}
      {picked ? <Check size={14} className={menu.check} /> : null}
    </Command.Item>
  );
}

export function ModelList({ models, value, recent, onChoose }: ModelListProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Held for the visit, so a row does not move from under the pointer when it is picked. Only the
  // id is held: the list can change under it, and the first one after a switch is the old app's.
  const [held] = useState(value);
  const pinned = pinnedModel(models, held);
  const pinnedId = pinned?.id;
  const groups = useMemo(() => groupModels(models, recent, pinnedId), [models, recent, pinnedId]);
  const all = [...groups.first, ...groups.more];
  const total = all.reduce((count, group) => count + group.models.length, 0);
  const folded = search === "" && !showAll;
  let room = SHOWN;
  const visible = folded
    ? groups.first.flatMap((group) => {
        const shown = group.models.slice(0, Math.max(room, 0));
        room -= shown.length;
        return shown.length === 0 ? [] : [{ ...group, models: shown }];
      })
    : all;
  const hidden = total - visible.reduce((count, group) => count + group.models.length, 0);
  const defaultName = modelName(models, undefined);
  const pickedId = pinnedModel(models, value)?.id;

  return (
    <Command label="Models" loop defaultValue={pinnedId ?? DEFAULT_VALUE}>
      <div className={styles.search}>
        <Search size={14} aria-hidden />
        <Command.Input
          // Otherwise the menu focuses the first AI app, and Enter switches to it.
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="Search models"
        />
      </div>
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No model matches.</Command.Empty>
        {pinned === undefined ? null : (
          <ModelRow
            model={pinned}
            picked={pinned.id === pickedId}
            keywords={[pinned.name, pinned.id]}
            onChoose={onChoose}
          />
        )}
        {search === "" ? (
          <Command.Item
            value={DEFAULT_VALUE}
            className={rowClass(pickedId === undefined)}
            onSelect={() => onChoose(undefined)}
          >
            <span className={`${menu.itemText} ${styles.modelName}`}>
              {defaultName === undefined ? "Default model" : `Default · ${defaultName}`}
            </span>
            {pickedId === undefined ? <Check size={14} className={menu.check} /> : null}
          </Command.Item>
        ) : null}
        {visible.map((group) => (
          <Command.Group key={group.heading} heading={group.heading}>
            {group.models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                picked={model.id === pickedId}
                keywords={[model.name, model.id, group.heading]}
                onChoose={onChoose}
              />
            ))}
          </Command.Group>
        ))}
        {folded && hidden > 0 ? (
          <Command.Item
            value={MORE_VALUE}
            className={`${menu.item} ${styles.more}`}
            onSelect={() => setShowAll(true)}
          >
            {hidden} more {hidden === 1 ? "model" : "models"}
          </Command.Item>
        ) : null}
      </Command.List>
    </Command>
  );
}
