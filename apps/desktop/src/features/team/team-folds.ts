import { useState } from "react";

const KEY = "office-town.team-folds";
// Past this many departments, ones the user never opened start folded.
const FOLD_PAST = 4;

// Storage can be cleared or blocked; every department then starts at its default.
function saved(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof value === "object" && value !== null ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

// Which departments on the Team page are folded to their header, remembered across launches.
export function useTeamFolds(count: number) {
  const [folds, setFolds] = useState(saved);
  const folded = (id: string) => folds[id] ?? count > FOLD_PAST;
  const toggle = (id: string) => {
    const next = { ...folds, [id]: !folded(id) };
    setFolds(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("Could not remember the folded departments.", error);
    }
  };
  return { folded, toggle };
}
