import { type Autonomy, autonomySchema } from "@office-town/contract";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { AUTONOMY } from "../../ui/autonomy.ts";
import menu from "../../ui/Menu.module.css";
import styles from "./Composer.module.css";

interface AskChipProps {
  value: Autonomy;
  // Goes through the bypass gate, which warns before turning every check off.
  onChoose: (level: Autonomy) => void;
  align?: "start" | "end";
  // Under the levels, such as who a change reaches.
  note?: string;
}

// How much it may do without asking; the harness's bypass sits last, apart, with its warning.
export function AskChip({ value, onChoose, align = "start", note }: AskChipProps) {
  const item = (level: Autonomy) => (
    <DropdownMenu.RadioItem value={level} className={menu.item}>
      <span className={menu.itemText}>
        {AUTONOMY[level].short}
        <span className={menu.itemDescription}>{AUTONOMY[level].description}</span>
      </span>
      <DropdownMenu.ItemIndicator>
        <Check size={14} className={menu.check} aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={styles.chip}
        aria-label={`Permissions: ${AUTONOMY[value].short}`}
      >
        <ShieldCheck size={14} aria-hidden />
        <span className={styles.chipText}>{AUTONOMY[value].short}</span>
        <ChevronDown size={13} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${menu.surface} ${styles.menu}`}
          align={align}
          sideOffset={6}
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const level = autonomySchema.safeParse(next);
              if (level.success) onChoose(level.data);
            }}
          >
            {item("supervised")}
            {item("full")}
            <DropdownMenu.Separator className={styles.separator} />
            {item("bypass")}
          </DropdownMenu.RadioGroup>
          {note === undefined ? null : (
            <>
              <DropdownMenu.Separator className={styles.separator} />
              <p className={`${menu.itemDescription} ${styles.menuNote}`}>{note}</p>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
