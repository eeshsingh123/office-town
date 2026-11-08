import { readKept, useKept, writeKept } from "../../store/kept.ts";
import { paneFlag } from "../../ui/pane.ts";

const COLLAPSED = paneFlag("sidebar-collapsed");

export const useSidebarCollapsed = () => useKept(COLLAPSED)[0];

export function toggleSidebar(): void {
  writeKept(COLLAPSED, !readKept(COLLAPSED));
}
