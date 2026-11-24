import { Check, ChevronDown, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import menu from "../../ui/Menu.module.css";
import { PlaceTag, PlaceTags } from "./PlaceTag.tsx";
import { openConnect, usePlaces } from "./places.ts";
import styles from "./Updates.module.css";

interface PlacePickerProps {
  // What the places are for, for screen readers: "Send results to".
  label: string;
  picked: readonly string[];
  onChange: (next: string[]) => void;
  // Shown while none is picked.
  empty?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// A small menu of connected apps to tick, with Connect a third-party application at its end. The
// trigger shows the picked ones.
export function PlacePicker({
  label,
  picked,
  onChange,
  empty = "Choose",
  open,
  onOpenChange,
}: PlacePickerProps) {
  const places = usePlaces() ?? [];
  const shown = places.filter((place) => picked.includes(place.id));
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...picked, id] : picked.filter((each) => each !== id));
  return (
    <DropdownMenu.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <DropdownMenu.Trigger className={styles.pick} aria-label={`${label}. Change`}>
        {shown.length === 0 ? empty : <PlaceTags places={shown} />}
        <ChevronDown size={13} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
          {places.map((place) => {
            const on = picked.includes(place.id);
            return (
              <DropdownMenu.CheckboxItem
                key={place.id}
                className={menu.item}
                checked={on}
                onCheckedChange={(next) => toggle(place.id, next)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className={`${styles.box} ${on ? styles.boxOn : ""}`} aria-hidden>
                  {on ? <Check size={11} /> : null}
                </span>
                <PlaceTag place={place} />
              </DropdownMenu.CheckboxItem>
            );
          })}
          {places.length === 0 ? null : <DropdownMenu.Separator className={menu.separator} />}
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => openConnect({ onConnected: (id) => onChange([...picked, id]) })}
          >
            <Plus size={14} className={menu.itemIcon} aria-hidden />
            Connect a third-party application
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
