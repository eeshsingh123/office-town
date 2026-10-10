import { create } from "zustand";
import { navigate, select } from "../../store/app-store.ts";

export type OfficeMode = "floor" | "board";
export type PanelKind = "chief" | "department" | "agent";
export type PanelTab = "overview" | "chat" | "work";

interface OfficeState {
  mode: OfficeMode;
  // Kept for the session.
  tabs: Record<PanelKind, PanelTab>;
  // Set when the composer should take focus; a follow-up names the goal it answers.
  compose: { at: number; taskId?: string } | undefined;
}

export const useOffice = create<OfficeState>(() => ({
  mode: "floor",
  tabs: { chief: "overview", department: "overview", agent: "overview" },
  compose: undefined,
}));

export function showMode(mode: OfficeMode): void {
  useOffice.setState({ mode });
}

export function chooseTab(kind: PanelKind, tab: PanelTab): void {
  useOffice.setState((state) => ({ tabs: { ...state.tabs, [kind]: tab } }));
}

export function composeIn(kind: PanelKind, taskId?: string): void {
  chooseTab(kind, "chat");
  useOffice.setState({ compose: { at: Date.now(), ...(taskId === undefined ? {} : { taskId }) } });
}

export function selectRoom(departmentId: string): void {
  select([]);
  showMode("floor");
  navigate({ name: "office", room: departmentId });
}

export function selectAgent(agentId: string): void {
  select([agentId]);
  showMode("floor");
  navigate({ name: "office" });
}
