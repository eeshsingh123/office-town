import { create } from "zustand";
import { savedFlag, saveFlag } from "../../ui/pane.ts";

const KEY = "sidebar-collapsed";

export const useSidebar = create<{ collapsed: boolean }>(() => ({ collapsed: savedFlag(KEY) }));

export function toggleSidebar(): void {
  const collapsed = !useSidebar.getState().collapsed;
  useSidebar.setState({ collapsed });
  saveFlag(KEY, collapsed);
}
