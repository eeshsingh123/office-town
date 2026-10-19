import { Gauge, MapIcon, PanelRightClose, PanelRightOpen, Plus, SquareKanban } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { HistoryButtons } from "../sidebar/HistoryButtons.tsx";
import { useSidebar } from "../sidebar/sidebar-state.ts";
import { fullest } from "../usage/limits.ts";
import { useMinute } from "../usage/use-usage.ts";
import { setPanelOpen, showMode, useOffice } from "./office-state.ts";
import styles from "./TopBar.module.css";
import { useCounts } from "./use-counts.ts";
import { goToNextWaiting } from "./waiting-keys.ts";

// Accounts used up right now; the bar names one, Usage has the rest.
function useFullAccounts(): string[] {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const now = useMinute();
  return accounts
    .filter((account) => (fullest(limits[account.id], now)?.usedFraction ?? 0) >= 1)
    .map((account) => {
      const harness = harnesses.find((known) => known.harness === account.harness)?.name;
      return `${harness ?? account.harness} · ${account.name}`;
    });
}

// Only what can be acted on: counts live on Home, usage on its own page.
export function TopBar() {
  const focus = useApp((state) => state.focus);
  const chiefId = useApp((state) => state.chiefId);
  const mode = useOffice((state) => state.mode);
  const panelOpen = useOffice((state) => state.panelOpen);
  const { working, order } = useCounts();
  const full = useFullAccounts();
  const collapsed = useSidebar((state) => state.collapsed);
  const at = focus === undefined ? -1 : order.indexOf(focus.agentId);

  return (
    <header className={styles.bar}>
      {/* The sidebar is collapsed, so back and forward live here. */}
      {collapsed ? <HistoryButtons /> : null}
      <ToggleGroup.Root
        type="single"
        className={styles.segments}
        value={mode}
        onValueChange={(next) => {
          if (next === "floor" || next === "board") showMode(next);
        }}
        aria-label="Show the office as"
      >
        <ToggleGroup.Item
          value="floor"
          className={styles.segment}
          title="Move with WASD or the arrow keys"
        >
          <MapIcon size={14} aria-hidden />
          Floor
        </ToggleGroup.Item>
        <ToggleGroup.Item value="board" className={styles.segment}>
          <SquareKanban size={14} aria-hidden />
          Board
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      {working === 0 ? null : <span className={styles.count}>{working} working</span>}

      <div className={styles.end}>
        {full.length === 0 ? null : (
          <button
            type="button"
            className={styles.limit}
            onClick={() => navigate({ name: "usage" })}
            title="Open Usage"
          >
            <Gauge size={13} aria-hidden />
            {full.length === 1
              ? `${full[0]} is at its limit`
              : `${full.length} accounts at their limit`}
          </button>
        )}
        {order.length === 0 ? null : (
          <button
            type="button"
            className={styles.needYou}
            onClick={goToNextWaiting}
            title="Go to the next waiting agent (N)"
          >
            <span className={styles.waitDot} aria-hidden />
            {at === -1 ? `${order.length} need you · Next` : `${at + 1} of ${order.length}`}
          </button>
        )}
        {/* The floor offers these in its corner. */}
        {mode === "board" && chiefId === undefined ? (
          <Button variant="ghost" onClick={() => navigate({ name: "chief" })}>
            <Plus size={14} aria-hidden />
            Chief
          </Button>
        ) : null}
        {mode === "board" ? (
          <Button variant="ghost" onClick={() => navigate({ name: "new-department" })}>
            <Plus size={14} aria-hidden />
            Department
          </Button>
        ) : null}
        {mode === "floor" ? (
          <button
            type="button"
            className={styles.panelToggle}
            onClick={() => setPanelOpen(!panelOpen)}
            aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
            title={panelOpen ? "Hide side panel" : "Show side panel"}
          >
            {panelOpen ? (
              <PanelRightClose size={16} aria-hidden />
            ) : (
              <PanelRightOpen size={16} aria-hidden />
            )}
          </button>
        ) : null}
      </div>
    </header>
  );
}
