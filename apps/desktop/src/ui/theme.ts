import { useSyncExternalStore } from "react";
import { shell } from "../shell.ts";

export type Theme = "light" | "dark";

const KEY = "office-town.theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

// Storage can be cleared or blocked; the app then follows the system.
function saved(): Theme | undefined {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

let chosen = saved();

const current = (): Theme => chosen ?? (systemDark.matches ? "dark" : "light");

// The tokens switch on `color-scheme` (tokens.css); the shell matches the window frame.
export function applyTheme() {
  document.documentElement.style.colorScheme = chosen ?? "";
  shell?.setTheme(chosen ?? "system").catch((error: unknown) => {
    console.warn("Could not match the window frame to the theme.", error);
  });
}

export function toggleTheme() {
  chosen = current() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, chosen);
  } catch (error) {
    console.warn("Could not remember the theme.", error);
  }
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
