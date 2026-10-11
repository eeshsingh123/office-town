import { create } from "zustand";
import { navigate, select } from "../../store/app-store.ts";

export type OfficeMode = "floor" | "board";
export type PanelKind = "chief" | "department" | "agent";
export type PanelTab = "now" | "activity" | "chat" | "profile";

interface OfficeState {
  mode: OfficeMode;
  // Kept for the session.
  tabs: Record<PanelKind, PanelTab>;
  panelOpen: boolean;
  // Set when the composer should take focus; a follow-up names the goal it answers.
  compose: { at: number; taskId?: string } | undefined;
}

export const useOffice = create<OfficeState>(() => ({
  mode: "floor",
  tabs: { chief: "now", department: "now", agent: "now" },
  panelOpen: true,
  compose: undefined,
}));

export function showMode(mode: OfficeMode): void {
  useOffice.setState({ mode });
}

export function setPanelOpen(panelOpen: boolean): void {
  useOffice.setState({ panelOpen });
}

export function chooseTab(kind: PanelKind, tab: PanelTab): void {
  useOffice.setState((state) => ({ tabs: { ...state.tabs, [kind]: tab } }));
}

export function composeIn(kind: PanelKind, taskId?: string): void {
  chooseTab(kind, "chat");
  useOffice.setState({ compose: { at: Date.now(), ...(taskId === undefined ? {} : { taskId }) } });
}

// Navigates first, so the screen left behind keeps its own selection for Back.
export function selectRoom(departmentId: string): void {
  navigate({ name: "office", room: departmentId });
  select([]);
  showMode("floor");
}

export function selectAgent(agentId: string): void {
  navigate({ name: "office" });
  select([agentId]);
  showMode("floor");
}
