import { type Keep, readKept, useKept, writeKept } from "../../store/kept.ts";

// Agents kept in view on every screen, in the order they were pinned.
const PINNED: Keep<string[]> = {
  name: "pinned-agents",
  lasts: "saved",
  start: [],
  parse: (saved) =>
    Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : undefined,
};

export const usePinned = () => useKept(PINNED)[0];

export const pinnedNow = () => readKept(PINNED);

export function pin(agentIds: string[]): void {
  const pinned = pinnedNow();
  writeKept(PINNED, [...pinned, ...agentIds.filter((id) => !pinned.includes(id))]);
}

export function unpin(agentIds: string[]): void {
  writeKept(
    PINNED,
    pinnedNow().filter((id) => !agentIds.includes(id)),
  );
}
