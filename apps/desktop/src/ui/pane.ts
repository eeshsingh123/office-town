import { type Keep, useKept } from "../store/kept.ts";

export interface PaneSize {
  initial: number;
  min: number;
  max: number;
}

// A flag about a pane, such as whether it is folded, remembered across launches.
export const paneFlag = (name: string): Keep<boolean> => ({
  name: `pane.${name}`,
  lasts: "saved",
  start: false,
});

// A pane's width, remembered across launches.
export function usePaneWidth(name: string, size: PaneSize): [number, (width: number) => void] {
  const [width, setWidth] = useKept<number>({
    name: `pane.${name}`,
    lasts: "saved",
    start: size.initial,
    parse: (saved) =>
      typeof saved === "number" && saved >= size.min && saved <= size.max ? saved : undefined,
  });
  const resize = (next: number) =>
    setWidth(Math.round(Math.min(size.max, Math.max(size.min, next))));
  return [width, resize];
}
