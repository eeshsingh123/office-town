import type { HarnessModel } from "@office-town/contract";
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import menu from "../../ui/Menu.module.css";
import { modelName } from "../profiles/model-name.ts";
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

export function ModelList({ models, value, recent, onChoose }: ModelListProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => groupModels(models, recent), [models, recent]);
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

  return (
    <Command label="Models" loop>
      <div className={styles.search}>
        <Search size={14} aria-hidden />
        <Command.Input value={search} onValueChange={setSearch} placeholder="Search models" />
      </div>
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>No model matches.</Command.Empty>
        {search === "" ? (
          <Command.Item
            value={DEFAULT_VALUE}
            className={menu.item}
            onSelect={() => onChoose(undefined)}
          >
            <span className={menu.itemText}>
              {defaultName === undefined ? "Default model" : `Default · ${defaultName}`}
            </span>
            {value === undefined ? <Check size={14} className={menu.check} /> : null}
          </Command.Item>
        ) : null}
        {visible.map((group) => (
          <Command.Group key={group.heading} heading={group.heading}>
            {group.models.map((model) => (
              <Command.Item
                key={model.id}
                value={model.id}
                keywords={[model.name, model.id, group.heading]}
                className={menu.item}
                onSelect={() => onChoose(model.id)}
              >
                <span className={menu.itemText}>
                  {model.name}
                  {model.description === undefined ? null : (
                    <span className={menu.itemDescription}>{model.description}</span>
                  )}
                </span>
                {model.access === "free" ? <span className={styles.free}>Free</span> : null}
                {model.id === value ? <Check size={14} className={menu.check} /> : null}
              </Command.Item>
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
