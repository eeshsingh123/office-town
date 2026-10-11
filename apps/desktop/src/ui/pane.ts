import { useState } from "react";

export interface PaneSize {
  initial: number;
  min: number;
  max: number;
}

const key = (name: string) => `office-town.pane.${name}`;

// Storage can be cleared or blocked; the pane then starts at its default width.
function saved(name: string, size: PaneSize): number {
  try {
    const value = Number(localStorage.getItem(key(name)));
    return value >= size.min && value <= size.max ? value : size.initial;
  } catch {
    return size.initial;
  }
}

// A pane's width, remembered across launches.
export function usePaneWidth(name: string, size: PaneSize): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => saved(name, size));
  const resize = (next: number) => {
    const clamped = Math.round(Math.min(size.max, Math.max(size.min, next)));
    setWidth(clamped);
    try {
      localStorage.setItem(key(name), String(clamped));
    } catch (error) {
      console.warn("Could not remember the pane width.", error);
    }
  };
  return [width, resize];
}

export function savedFlag(name: string): boolean {
  try {
    return localStorage.getItem(key(name)) === "true";
  } catch {
    return false;
  }
}

export function saveFlag(name: string, value: boolean): void {
  try {
    localStorage.setItem(key(name), String(value));
  } catch (error) {
    console.warn("Could not remember the pane state.", error);
  }
}
