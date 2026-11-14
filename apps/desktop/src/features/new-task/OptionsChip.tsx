import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Popover } from "radix-ui";
import menu from "../../ui/Menu.module.css";
import { SwitchRow } from "../../ui/Switch.tsx";
import { TASK_OPTIONS, type TaskOption, type TaskOptions } from "../task/task-options.ts";
import styles from "./Composer.module.css";

interface OptionsChipProps {
  value: TaskOptions;
  onChange: (key: TaskOption, on: boolean) => void;
}

// This task's own choices, starting from the defaults in Settings.
export function OptionsChip({ value, onChange }: OptionsChipProps) {
  const on = TASK_OPTIONS.filter((option) => value[option.key]);
  // Says what is on, so both off never reads as both on.
  const short = (option: (typeof TASK_OPTIONS)[number]) => option.label.replace(/ mode$/, "");
  const label =
    on.length === 0
      ? `${TASK_OPTIONS.map(short).join(" & ")} off`
      : `${on.map(short).join(" & ")} on`;
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`${styles.chip} ${on.length === 0 ? styles.chipOff : ""}`}
        aria-label={`Efficient mode and Milestones: ${on.length === 0 ? "both off" : label}`}
        title="Efficient mode and Milestones"
      >
        <SlidersHorizontal size={14} aria-hidden />
        <span className={styles.chipText}>{label}</span>
        <ChevronDown size={13} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.optionsMenu}`}
          align="start"
          sideOffset={6}
        >
          {TASK_OPTIONS.map((option) => (
            <SwitchRow
              key={option.key}
              label={option.label}
              hint={option.hint}
              on={value[option.key]}
              onChange={(next) => onChange(option.key, next)}
            />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
