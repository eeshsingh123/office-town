import type { LibraryItem } from "@office-town/contract";
import { type KeyboardEvent, type RefObject, useId, useState } from "react";
import { sizeText, typeLabel } from "../attachments/kinds.ts";
import { type Mention, mentionAt, withoutMention } from "../new-task/targets.ts";
import styles from "./Library.module.css";

interface PickerOptions {
  items: readonly LibraryItem[];
  text: string;
  setText: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  onPick: (item: LibraryItem) => void;
}

// "#" in a message box lists the Library's files; picking one attaches it and drops the "#word".
export function useLibraryPicker({ items, text, setText, field, onPick }: PickerOptions) {
  const [found, setFound] = useState<Mention>();
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const matching = (mention: Mention) =>
    items.filter((item) => item.file.name.toLowerCase().includes(mention.query));
  const listed = found === undefined ? [] : matching(found);
  const active = Math.min(highlight, listed.length - 1);

  const pick = (item: LibraryItem) => {
    const element = field.current;
    if (found === undefined || element === null) return;
    setText(withoutMention(text, found, element.selectionStart));
    onPick(item);
    setFound(undefined);
    element.focus();
  };

  // Plain text, such as "issue #12", never opens an empty list.
  const onInput = (value: string, caret: number) => {
    const mention = mentionAt(value, caret);
    setFound(mention?.kind === "#" && matching(mention).length > 0 ? mention : undefined);
    setHighlight(0);
  };

  // True when the key belonged to the list.
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (listed.length === 0) return false;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) setHighlight((active + step + listed.length) % listed.length);
    else if (event.key === "Enter" || event.key === "Tab") {
      const item = listed[active];
      if (item !== undefined) pick(item);
    } else if (event.key === "Escape") setFound(undefined);
    else return false;
    event.preventDefault();
    return true;
  };

  const open = listed.length > 0;
  return {
    onInput,
    onKeyDown,
    close: () => setFound(undefined),
    comboboxProps: {
      role: "combobox",
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open ? `${listId}-${active}` : undefined,
    },
    list: open ? (
      <div id={listId} className={styles.picker} role="listbox" aria-label="From the Library">
        <div className={styles.pickerHeading} role="presentation">
          From the Library
        </div>
        {listed.map((item, index) => (
          <button
            key={item.id}
            id={`${listId}-${index}`}
            type="button"
            tabIndex={-1}
            role="option"
            aria-selected={index === active}
            className={styles.pickerOption}
            // Keeps the caret in the box.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(item)}
          >
            <span className={styles.tile} aria-hidden>
              {typeLabel(item.file.name, item.file.kind)}
            </span>
            <span className={styles.nameText}>
              <b>{item.file.name}</b>
              <span>
                {item.file.kind === "folder" ? "Linked folder" : sizeText(item.file.bytes ?? 0)}
              </span>
            </span>
          </button>
        ))}
      </div>
    ) : null,
  };
}
