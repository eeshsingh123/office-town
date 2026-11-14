import type { ConnectorRecord } from "@office-town/contract";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApp } from "../../store/app-store.ts";
import pickerStyles from "../library/Library.module.css";
import { type Mention, mentionAt } from "../new-task/targets.ts";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./AppTags.module.css";
import { type AppHolder, usableBy } from "./connectors.ts";

// A tag is the app's name after "@" in the message itself, so the agent reads it as written.
export const tagOf = (name: string) => `@${name}`;

const uniqueNames = (connectors: readonly ConnectorRecord[]) =>
  [...new Set(connectors.map(({ setup }) => setup.name))].toSorted((a, b) => a.localeCompare(b));

// The apps the agent can use now, each once.
export function useTaggableApps(holder: AppHolder | undefined): string[] {
  const connectors = useApp((state) => state.connectors);
  return holder === undefined ? [] : uniqueNames(usableBy(Object.values(connectors), holder));
}

// Every app the user has, to show tags in messages already sent.
export function useAppNames(): string[] {
  const connectors = useApp((state) => state.connectors);
  return useMemo(() => uniqueNames(Object.values(connectors)), [connectors]);
}

export type TagPart = { text: string } | { app: string; text: string };

// "@" after a space or at the start, then a known name, then no letter or digit. Longest names
// first, so "@Google Drive" is not read as "@Google".
export function splitTags(text: string, names: readonly string[]): TagPart[] {
  if (names.length === 0 || !text.includes("@")) return [{ text }];
  const longest = names.toSorted((a, b) => b.length - a.length);
  const parts: TagPart[] = [];
  let plain = "";
  let index = 0;
  while (index < text.length) {
    const before = index === 0 ? " " : (text[index - 1] ?? " ");
    const app =
      text[index] === "@" && /\s/.test(before)
        ? longest.find((name) => {
            const end = index + 1 + name.length;
            return (
              text.slice(index + 1, end).toLowerCase() === name.toLowerCase() &&
              !/[\p{L}\p{N}]/u.test(text[end] ?? "")
            );
          })
        : undefined;
    if (app === undefined) {
      plain += text[index];
      index += 1;
      continue;
    }
    if (plain !== "") parts.push({ text: plain });
    plain = "";
    const written = text.slice(index, index + 1 + app.length);
    parts.push({ app, text: written });
    index += written.length;
  }
  if (plain !== "") parts.push({ text: plain });
  return parts;
}

// A tag in a message already sent: the app's logo and its name.
export function TaggedText({ text, names }: { text: string; names: readonly string[] }) {
  return (
    <>
      {splitTags(text, names).map((part, index) =>
        "app" in part ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never move
          <span key={index} className={styles.tag}>
            <AppLogo app={part.app} size="sm" />
            {part.app}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

// The same text drawn under the box, so each tag shows as a highlight with its logo over the "@".
// The box's own text turns clear only while a tag is in it, keeping its caret and selection.
export function TagLayer({
  field,
  text,
  names,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  names: readonly string[];
}) {
  const layer = useRef<HTMLDivElement>(null);
  const parts = splitTags(text, names);
  const tagged = parts.some((part) => "app" in part);

  // Clear text on top, drawn text under it: the box keeps its caret, selection and typing.
  useLayoutEffect(() => {
    const box = field.current;
    if (box === null || !tagged) return;
    box.style.position = "relative";
    box.style.color = "transparent";
    box.style.caretColor = "var(--text)";
    return () => {
      box.style.position = "";
      box.style.color = "";
      box.style.caretColor = "";
    };
  }, [field, tagged]);

  useLayoutEffect(() => {
    const box = field.current;
    const under = layer.current;
    if (box === null || under === null) return;
    const place = () => {
      const style = getComputedStyle(box);
      for (const key of [
        "font",
        "letterSpacing",
        "lineHeight",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "tabSize",
      ] as const) {
        under.style[key] = style[key];
      }
      // Inside the box's border and scroll bar, so lines wrap where the box wraps them.
      under.style.top = `${box.offsetTop + box.clientTop}px`;
      under.style.left = `${box.offsetLeft + box.clientLeft}px`;
      under.style.width = `${box.clientWidth}px`;
      under.style.height = `${box.clientHeight}px`;
      under.scrollTop = box.scrollTop;
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(box);
    box.addEventListener("scroll", place);
    return () => {
      resized.disconnect();
      box.removeEventListener("scroll", place);
    };
  });

  if (!tagged) return null;
  return (
    <div ref={layer} className={styles.layer} aria-hidden>
      {parts.map((part, index) =>
        "app" in part ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: redrawn whole with the text
          <mark key={index} className={styles.mark}>
            <span className={styles.at}>
              @
              <span className={styles.atLogo}>
                <AppLogo app={part.app} size="sm" />
              </span>
            </span>
            {part.text.slice(1)}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: redrawn whole with the text
          <span key={index}>{part.text}</span>
        ),
      )}
      {/* A last empty line still takes its height. */}
      {"​"}
    </div>
  );
}

interface AppPickerOptions {
  apps: readonly string[];
  text: string;
  setText: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
}

// "@" in a message box lists the apps the agent can use; picking one writes its tag.
export function useAppPicker({ apps, text, setText, field }: AppPickerOptions) {
  const [found, setFound] = useState<Mention>();
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const matching = (mention: Mention) =>
    apps.filter((name) => name.toLowerCase().includes(mention.query));
  const listed = found === undefined ? [] : matching(found);
  const active = Math.min(highlight, listed.length - 1);

  const pick = (name: string) => {
    const element = field.current;
    if (found === undefined || element === null) return;
    const caret = element.selectionStart;
    const written = `${tagOf(name)} `;
    setText(text.slice(0, found.start) + written + text.slice(caret));
    setFound(undefined);
    element.focus();
    const at = found.start + written.length;
    requestAnimationFrame(() => element.setSelectionRange(at, at));
  };

  // An "@" with no app to match, such as in an email address, never opens an empty list.
  const onInput = (value: string, caret: number) => {
    const mention = mentionAt(value, caret);
    setFound(mention?.kind === "@" && matching(mention).length > 0 ? mention : undefined);
    setHighlight(0);
  };

  // True when the key belonged to the list.
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (listed.length === 0) return false;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) setHighlight((active + step + listed.length) % listed.length);
    else if (event.key === "Enter" || event.key === "Tab") {
      const name = listed[active];
      if (name !== undefined) pick(name);
    } else if (event.key === "Escape") setFound(undefined);
    else return false;
    event.preventDefault();
    return true;
  };

  const open = listed.length > 0;
  const list: ReactNode = open ? (
    <div id={listId} className={pickerStyles.picker} role="listbox" aria-label="Apps">
      <div className={pickerStyles.pickerHeading} role="presentation">
        Apps
      </div>
      {listed.map((name, index) => (
        <button
          key={name}
          id={`${listId}-${index}`}
          type="button"
          tabIndex={-1}
          role="option"
          aria-selected={index === active}
          className={pickerStyles.pickerOption}
          // Keeps the caret in the box.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(name)}
        >
          <AppLogo app={name} size="sm" />
          <span className={pickerStyles.nameText}>
            <b>{name}</b>
          </span>
        </button>
      ))}
    </div>
  ) : null;
  return {
    open,
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
    list,
  };
}
