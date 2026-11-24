import type { NoticeKind } from "@office-town/contract";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "../../ui/Button.tsx";
import menu from "../../ui/Menu.module.css";
import { ALERTS } from "./places.ts";
import styles from "./Updates.module.css";

// One place: its tag, a short line under it, then its controls. The same row in Settings and
// Connectors.
export function PlaceRow({
  tag,
  detail,
  warn = false,
  children,
}: {
  tag: ReactNode;
  detail: ReactNode;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowText}>
        {tag}
        <span className={`${styles.detail} ${warn ? styles.warn : ""}`}>{detail}</span>
      </span>
      <span className={styles.rowEnd}>{children}</span>
    </div>
  );
}

// Which alerts a place hears, ticked in a small menu.
export function HearsMenu({
  place,
  heard,
  onChange,
}: {
  place: string;
  heard: (kind: NoticeKind) => boolean;
  onChange: (kind: NoticeKind, on: boolean) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" aria-label={`Choose what ${place} hears about`}>
          Choose
          <ChevronDown size={13} aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
          {ALERTS.map(({ kind, label }) => {
            const on = heard(kind);
            return (
              <DropdownMenu.CheckboxItem
                key={kind}
                className={menu.item}
                checked={on}
                onCheckedChange={(next) => onChange(kind, next)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className={`${styles.box} ${on ? styles.boxOn : ""}`} aria-hidden>
                  {on ? <Check size={11} /> : null}
                </span>
                {label}
              </DropdownMenu.CheckboxItem>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
