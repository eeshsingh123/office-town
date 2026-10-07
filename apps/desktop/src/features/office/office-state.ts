import { create } from "zustand";
import { navigate, select } from "../../store/app-store.ts";

export type OfficeMode = "floor" | "board";
export type PanelKind = "chief" | "department" | "agent";
export type PanelTab = "overview" | "chat" | "work";

interface OfficeState {
  mode: OfficeMode;
  // The tab last chosen for each kind of selection, kept for the session.
  tabs: Record<PanelKind, PanelTab>;
  // Set when the chat's composer should take focus, such as for a follow-up.
  composeAt: number | undefined;
  chiefSettingsOpen: boolean;
}

export const useOffice = create<OfficeState>(() => ({
  mode: "floor",
  tabs: { chief: "overview", department: "overview", agent: "overview" },
  composeAt: undefined,
  chiefSettingsOpen: false,
}));

export function showMode(mode: OfficeMode): void {
  useOffice.setState({ mode });
}

export function chooseTab(kind: PanelKind, tab: PanelTab): void {
  useOffice.setState((state) => ({ tabs: { ...state.tabs, [kind]: tab } }));
}

// Opens the chat of what is selected next, with its composer ready.
export function composeIn(kind: PanelKind): void {
  chooseTab(kind, "chat");
  useOffice.setState({ composeAt: Date.now() });
}

export function openChiefSettings(open = true): void {
  useOffice.setState({ chiefSettingsOpen: open });
}

// Shows a department's room on the floor, with its panel.
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
