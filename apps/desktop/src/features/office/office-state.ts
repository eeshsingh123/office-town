import { create } from "zustand";
import { navigate, select, useApp } from "../../store/app-store.ts";
import type { Point } from "./floor-plan.ts";

export type OfficeMode = "floor" | "board";
export type PanelKind = "chief" | "department" | "agent";
export type PanelTab = "now" | "activity" | "chat" | "profile";

// The open floor's room id; it opens like a department's room.
export const OPEN_FLOOR = "open";

interface OfficeState {
  mode: OfficeMode;
  // Kept for the session.
  tabs: Record<PanelKind, PanelTab>;
  panelOpen: boolean;
  // Set when the composer should take focus; a follow-up names the goal it answers.
  compose: { at: number; taskId?: string } | undefined;
  // Where the user stood and which room was open, so leaving the Office and coming back finds
  // both as they were. Memory only: a restart starts at the door.
  player: Point | undefined;
  room: string | undefined;
  // Free rooms fold into one strip past FOLD_AFTER departments, unless the user shows them all.
  showAllRooms: boolean;
}

// More departments than this and the free ones fold (design audit a2-2).
export const FOLD_AFTER = 6;

export const useOffice = create<OfficeState>(() => ({
  mode: "floor",
  tabs: { chief: "now", department: "now", agent: "now" },
  // Closed until something is picked, so the floor has the width (design audit a2-4).
  panelOpen: false,
  compose: undefined,
  player: undefined,
  room: undefined,
  showAllRooms: false,
}));

export function setShowAllRooms(showAllRooms: boolean): void {
  useOffice.setState({ showAllRooms });
}

export function setPlayer(update: (at: Point | undefined) => Point): void {
  useOffice.setState((state) => ({ player: update(state.player) }));
}

export function rememberRoom(room: string | undefined): void {
  useOffice.setState({ room });
}

// Coming back to the Office with nothing asked for opens the room left open, in place, so Back
// still leads to the screen before.
export function reopenRoom(exists: (room: string) => boolean): void {
  const { room } = useOffice.getState();
  const { view, selection } = useApp.getState();
  if (room === undefined || !exists(room)) return;
  if (view.name !== "office" || view.room !== undefined || selection.length > 0) return;
  useApp.setState({ view: { name: "office", room } });
}

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

// Double-click or Enter: the chat of the one picked, ready to type in.
export function openChat(kind: PanelKind): void {
  composeIn(kind);
  setPanelOpen(true);
}
