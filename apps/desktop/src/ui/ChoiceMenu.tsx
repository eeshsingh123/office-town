import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import styles from "./Menu.module.css";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface ChoiceMenuProps<T extends string> {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

// A labelled chip that opens a list of choices, one of them current.
export function ChoiceMenu<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: ChoiceMenuProps<T>) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={styles.chip} disabled={disabled}>
        <span className={styles.chipLabel}>{label}</span>
        {current?.label ?? value}
        <ChevronDown size={14} className={styles.chipLabel} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.surface} align="start" sideOffset={4}>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const chosen = choices.find((choice) => choice.value === next);
              if (chosen !== undefined) onChange(chosen.value);
            }}
          >
            {choices.map((choice) => (
              <DropdownMenu.RadioItem
                key={choice.value}
                value={choice.value}
                className={styles.item}
              >
                <span className={styles.itemText}>
                  {choice.label}
                  {choice.description === undefined ? null : (
                    <span className={styles.itemDescription}>{choice.description}</span>
                  )}
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check size={14} className={styles.check} aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
