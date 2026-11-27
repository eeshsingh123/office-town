import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Popover } from "radix-ui";
import menu from "../../ui/Menu.module.css";
import { SwitchRow } from "../../ui/Switch.tsx";
import { TASK_OPTIONS, type TaskOption, type TaskOptions } from "../task/task-options.ts";
import { SendResultRow } from "../updates/SendResultRow.tsx";
import styles from "./Composer.module.css";

interface OptionsChipProps {
  value: TaskOptions;
  onChange: (key: TaskOption, on: boolean) => void;
  // Left out for an automation, whose Rules say where its results go.
  sendResult?: { on: boolean; onChange: (on: boolean) => void };
}

// This task's own choices, starting from the defaults in Settings.
export function OptionsChip({ value, onChange, sendResult }: OptionsChipProps) {
  // Says what is on, so both off never reads as both on.
  const short = (option: (typeof TASK_OPTIONS)[number]) => option.label.replace(/ mode$/, "");
  const on = [
    ...TASK_OPTIONS.filter((option) => value[option.key]).map(short),
    ...(sendResult?.on === true ? ["Send result"] : []),
  ];
  // Past two, a count, so the chip stays one short line.
  const label =
    on.length === 0
      ? "Options off"
      : on.length > 2
        ? `${on.length} options on`
        : `${on.join(" & ")} on`;
  return (
    <Popover.Root>
      <Popover.Trigger
        className={`${styles.chip} ${on.length === 0 ? styles.chipOff : ""}`}
        aria-label={`Options for this task: ${label}`}
        title="Options for this task"
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
          {sendResult === undefined ? null : <SendResultRow {...sendResult} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
