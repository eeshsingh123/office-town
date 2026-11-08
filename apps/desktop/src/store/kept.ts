import { useLayoutEffect, useState } from "react";
import { create } from "zustand";
import { loadLastKnown, saveLastKnown } from "../api/last-known.ts";
import { shaped } from "./drafts.ts";

// "session" is where the user was on a screen, so Back finds it as left; a restart starts clean.
// "saved" outlives the app: preferences and what the user chose to keep.
export type Lasts = "session" | "saved";

export interface Keep<T> {
  name: string;
  lasts: Lasts;
  start: T;
  // For saved values only: one from an older version, or a cleared store, that does not fit is
  // dropped. By default it must have the fields `start` has.
  parse?: (saved: unknown) => T | undefined;
}

export const forSession = <T>(name: string, start: T): Keep<T> => ({
  name,
  lasts: "session",
  start,
});

// A parse for a choice out of a fixed few.
export const oneOf =
  <T>(choices: readonly T[]) =>
  (saved: unknown): T | undefined =>
    choices.find((choice) => choice === saved);

// Values set in this run; a screen showing one follows its changes.
const useKeptValues = create<Record<string, unknown>>(() => ({}));
// Saved values read from storage once, then from here.
const loaded = new Map<string, unknown>();

function fromStorage<T>(keep: Keep<T>): unknown {
  if (!loaded.has(keep.name)) {
    loaded.set(keep.name, loadLastKnown(keep.name, keep.parse ?? shaped<T>(keep.start)));
  }
  return loaded.get(keep.name);
}

export function readKept<T>(keep: Keep<T>): T {
  const values = useKeptValues.getState();
  const value =
    keep.name in values || keep.lasts === "session" ? values[keep.name] : fromStorage(keep);
  return value === undefined ? keep.start : (value as T);
}

export function writeKept<T>(keep: Keep<T>, value: T): void {
  if (keep.lasts === "saved") saveLastKnown(keep.name, value);
  useKeptValues.setState({ [keep.name]: value });
}

// Like useState, but the value outlives the screen for as long as `keep.lasts` says.
export function useKept<T>(keep: Keep<T>): [T, (next: T) => void] {
  useKeptValues((values) => values[keep.name]);
  return [readKept(keep), (next: T) => writeKept(keep, next)];
}

// A list's scroll place for the session, so Back lands where the user left it.
export function useKeptScroll(name: string) {
  const keep: Keep<number> = { name: `scroll.${name}`, lasts: "session", start: 0 };
  const [element, setElement] = useState<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restores once per element
  useLayoutEffect(() => {
    if (element !== null) element.scrollTop = readKept(keep);
  }, [element]);
  const onScroll = () => {
    if (element !== null) writeKept(keep, element.scrollTop);
  };
  return { ref: setElement, onScroll };
}
