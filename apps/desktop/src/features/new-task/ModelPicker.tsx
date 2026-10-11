import type { HarnessModel } from "@office-town/contract";
import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import menu from "../../ui/Menu.module.css";
import { ModelList } from "./ModelList.tsx";
import styles from "./ModelPicker.module.css";
import { modelName } from "./model-groups.ts";

interface ModelPickerProps {
  models: readonly HarnessModel[] | undefined;
  error: string | undefined;
  value: string | undefined;
  recent: readonly string[];
  onChange: (model: string | undefined) => void;
}

function triggerText(error: string | undefined, models: readonly HarnessModel[], value?: string) {
  if (error !== undefined) return "Unavailable";
  if (models.length === 0) return "Loading…";
  return modelName(models, value) ?? "Default";
}

export function ModelPicker({ models = [], error, value, recent, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
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
          <ModelList
            models={models}
            value={value}
            recent={recent}
            onChoose={(model) => {
              onChange(model);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
