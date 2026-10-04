import type { HarnessModel } from "@office-town/contract";
import { Command } from "cmdk";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";
import menu from "../../ui/Menu.module.css";
import styles from "./ModelPicker.module.css";
import { groupModels } from "./model-groups.ts";

interface ModelPickerProps {
  models: readonly HarnessModel[] | undefined;
  error: string | undefined;
  value: string | undefined;
  recent: readonly string[];
  onChange: (model: string | undefined) => void;
}

// Values no model id can take, since an id must start with a letter or digit.
const DEFAULT_VALUE = "~default";
const MORE_VALUE = "~more";

function triggerText(error: string | undefined, models: readonly HarnessModel[], value?: string) {
  if (error !== undefined) return "Unavailable";
  if (models.length === 0) return "Loading…";
  if (value === undefined) return "Default";
  return models.find((model) => model.id === value)?.name ?? value;
}

export function ModelPicker({ models = [], error, value, recent, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showMore, setShowMore] = useState(false);
  const groups = useMemo(() => groupModels(models, recent), [models, recent]);
  const hidden = groups.more.reduce((count, group) => count + group.models.length, 0);
  const visible = search !== "" || showMore ? [...groups.first, ...groups.more] : groups.first;

  const choose = (model: string | undefined) => {
    onChange(model);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={menu.chip}
        disabled={error !== undefined || models.length === 0}
        title={error}
      >
        <span className={menu.chipLabel}>Model</span>
        {triggerText(error, models, value)}
        <ChevronDown size={14} className={menu.chipLabel} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.picker}`}
          align="start"
          sideOffset={4}
        >
          <Command label="Models" loop>
            <div className={styles.search}>
              <Search size={14} aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={`Filter ${models.length} models`}
              />
            </div>
            <Command.List className={styles.list}>
              <Command.Empty className={styles.empty}>No model matches.</Command.Empty>
              {search === "" ? (
                <Command.Item
                  value={DEFAULT_VALUE}
                  className={menu.item}
                  onSelect={() => choose(undefined)}
                >
                  <span className={menu.itemText}>The harness's default</span>
                  {value === undefined ? <Check size={14} className={menu.check} /> : null}
                </Command.Item>
              ) : null}
              {visible.map((group) => (
                <Command.Group key={group.heading} heading={group.heading}>
                  {group.models.map((model) => (
                    <Command.Item
                      key={model.id}
                      value={model.id}
                      keywords={[model.name, group.heading]}
                      className={menu.item}
                      onSelect={() => choose(model.id)}
                    >
                      <span className={menu.itemText}>
                        {model.name}
                        {model.name === model.id ? null : (
                          <span className={menu.itemDescription}>{model.id}</span>
                        )}
                      </span>
                      {model.free === true ? <span className={styles.free}>Free</span> : null}
                      {model.id === value ? <Check size={14} className={menu.check} /> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {search === "" && !showMore && hidden > 0 ? (
                <Command.Item
                  value={MORE_VALUE}
                  className={`${menu.item} ${styles.more}`}
                  onSelect={() => setShowMore(true)}
                >
                  Other providers · {hidden} models
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
