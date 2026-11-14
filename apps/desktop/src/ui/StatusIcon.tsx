import { CircleMinus, LoaderCircle, Moon, X } from "lucide-react";
import type { AgentState } from "../trace/progress.ts";
import styles from "./StatusIcon.module.css";

// Five words for an agent. Only a task or a part is ever "Done"; a finished agent is free.
export const STATE_LABELS: Record<AgentState, string> = {
  starting: "Working",
  working: "Working",
  background: "Working",
  waiting: "Needs you",
  idle: "Free",
  done: "Free",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Stopped",
};

export const subAgentCount = (count: number) =>
  count === 1 ? "1 sub-agent" : `${count} sub-agents`;

// The line under Working says what it waits on, where the place has room for it.
export function stateLabel(state: AgentState, subAgents: number): string {
  if (state === "background") {
    return subAgents > 0 ? `Waiting on ${subAgentCount(subAgents)}` : "Waiting on sub-agents";
  }
  return STATE_LABELS[state];
}

// Status is a small icon, never a large fill (D-37): blue moves, amber asks, grey sleeps.
export function StatusIcon({ state, size = 14 }: { state: AgentState; size?: number }) {
  const label = STATE_LABELS[state];
  switch (state) {
    case "starting":
    case "working":
    case "background":
      return (
        <LoaderCircle
          size={size}
          aria-label={label}
          className={`${styles.icon} ${styles.working} spin`}
        />
      );
    case "waiting":
      return <span role="img" aria-label={label} className={styles.dot} />;
    case "idle":
    case "done":
      return <Moon size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />;
    case "failed":
      return <X size={size} aria-label={label} className={`${styles.icon} ${styles.bad}`} />;
    case "stopped":
    case "interrupted":
      return (
        <CircleMinus size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />
      );
  }
}
