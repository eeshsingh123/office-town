import { useSyncExternalStore } from "react";
import { shell } from "../shell.ts";
import { type Keep, readKept, writeKept } from "../store/kept.ts";

export type Theme = "light" | "dark";

// Unset follows the system.
const CHOSEN: Keep<Theme | undefined> = {
  name: "theme",
  lasts: "saved",
  start: undefined,
  parse: (saved) => (saved === "light" || saved === "dark" ? saved : undefined),
};
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

const current = (): Theme => readKept(CHOSEN) ?? (systemDark.matches ? "dark" : "light");

// The tokens switch on `color-scheme` (tokens.css); the shell matches the window frame.
export function applyTheme() {
  const chosen = readKept(CHOSEN);
  document.documentElement.style.colorScheme = chosen ?? "";
  shell?.setTheme(chosen ?? "system").catch((error: unknown) => {
    console.warn("Could not match the window frame to the theme.", error);
  });
}

export function toggleTheme() {
  writeKept(CHOSEN, current() === "dark" ? "light" : "dark");
  applyTheme();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  systemDark.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    systemDark.removeEventListener("change", listener);
  };
}

export const useTheme = () => useSyncExternalStore(subscribe, current);
