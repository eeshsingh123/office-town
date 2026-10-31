import { useEffect, useState } from "react";
import { create } from "zustand";
import { loadLastKnown, saveLastKnown } from "../api/last-known.ts";

const SAVED_NAME = "drafts";
const KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

interface Draft {
  value: unknown;
  savedAt: number;
}

type Drafts = Record<string, Draft>;

// An answered request or a removed agent leaves its draft behind; age clears those out.
function loadDrafts(): Drafts {
  const oldest = Date.now() - KEPT_FOR_MS;
  const saved = loadLastKnown(SAVED_NAME, (stored) => stored as Drafts | null) ?? {};
  return Object.fromEntries(Object.entries(saved).filter(([, draft]) => draft.savedAt > oldest));
}

// What the user typed and has not finished, so it outlives the screen and the app (D-81).
// A draft is named `scope.field`, so a form's fields clear together.
const useDrafts = create<{ drafts: Drafts; round: number }>(() => ({
  drafts: loadDrafts(),
  round: 0,
}));

function keep(drafts: Drafts) {
  useDrafts.setState({ drafts });
  saveLastKnown(SAVED_NAME, drafts);
}

const inScope = (name: string, scope: string) => name === scope || name.startsWith(`${scope}.`);

const isBlank = (value: unknown) =>
  value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

export const readDraft = (name: string): unknown => useDrafts.getState().drafts[name]?.value;

export function writeDraft(name: string, value: unknown): void {
  keep({ ...useDrafts.getState().drafts, [name]: { value, savedAt: Date.now() } });
}

// For a form that is done; what is on screen stays, as after a Save.
export function clearDrafts(scope: string): void {
  const { drafts } = useDrafts.getState();
  keep(Object.fromEntries(Object.entries(drafts).filter(([name]) => !inScope(name, scope))));
}

// The user threw it away, so the screen opens afresh (App remounts it on a new round).
export function discardDrafts(scope: string): void {
  clearDrafts(scope);
  useDrafts.setState(({ round }) => ({ round: round + 1 }));
}

export const useDraftRound = () => useDrafts((state) => state.round);

export const useHasDraft = (scope: string) =>
  useDrafts(({ drafts }) =>
    Object.entries(drafts).some(([name, draft]) => inScope(name, scope) && !isBlank(draft.value)),
  );

// A draft from before its form changed could break the form. `shape` holds what every saved value
// must have, so it leaves out optional fields.
export function fits(saved: unknown, shape: unknown): boolean {
  if (shape === undefined || shape === null) return true;
  if (Array.isArray(shape)) {
    return (
      Array.isArray(saved) && (shape.length === 0 || saved.every((one) => fits(one, shape[0])))
    );
  }
  if (typeof shape !== "object") return typeof saved === typeof shape;
  if (typeof saved !== "object" || saved === null) return false;
  const fields = saved as Record<string, unknown>;
  return Object.entries(shape).every(([key, value]) => fits(fields[key], value));
}

export const shaped =
  <T>(shape: unknown) =>
  (saved: unknown) =>
    fits(saved, shape) ? (saved as T) : undefined;

// For a form opened with something handed over, which wins over what was left in it.
export const ignoreDraft = () => undefined;

export const SETTINGS_SHAPE = { harness: "", environment: { kind: "" } };

// Like useState, but what is set is kept until the form clears it. A reply that lands after the
// screen was left, and reopened, reaches the form that is open now.
export function useDraft<T>(
  name: string,
  start: T | (() => T),
  parse?: (saved: unknown) => T | undefined,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const opening = typeof start === "function" ? (start as () => T)() : start;
    const saved = readDraft(name);
    if (saved === undefined) return opening;
    return (parse ?? shaped<T>(opening))(saved) ?? opening;
  });
  useEffect(
    () =>
      useDrafts.subscribe(({ drafts }, before) => {
        const draft = drafts[name];
        if (draft !== undefined && draft !== before.drafts[name]) setValue(draft.value as T);
      }),
    [name],
  );
  const change = (next: T) => {
    setValue(next);
    writeDraft(name, next);
  };
  return [value, change];
}
