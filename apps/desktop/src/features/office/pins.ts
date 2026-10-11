import { create } from "zustand";

const KEY = "office-town.pinned-agents";

// Storage can be cleared or blocked; nothing is pinned then.
function saved(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// Agents kept in view on every screen, in the order they were pinned.
export const usePins = create<{ pinned: string[] }>(() => ({ pinned: saved() }));

function save(pinned: string[]): void {
  usePins.setState({ pinned });
  try {
    localStorage.setItem(KEY, JSON.stringify(pinned));
  } catch (error) {
    console.warn("Could not remember the pinned agents.", error);
  }
}

export function pin(agentIds: string[]): void {
  const { pinned } = usePins.getState();
  save([...pinned, ...agentIds.filter((id) => !pinned.includes(id))]);
}

export function unpin(agentIds: string[]): void {
  save(usePins.getState().pinned.filter((id) => !agentIds.includes(id)));
}
