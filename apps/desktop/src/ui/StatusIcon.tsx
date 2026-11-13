import { Check, CircleMinus, CornerDownRight, LoaderCircle, X } from "lucide-react";
import type { AgentState } from "../trace/progress.ts";
import styles from "./StatusIcon.module.css";

export const STATE_LABELS: Record<AgentState, string> = {
  starting: "Starting",
  working: "Working",
  background: "Waiting on sub-agents",
  waiting: "Needs you",
  idle: "Done",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

export const subAgentCount = (count: number) =>
  count === 1 ? "1 sub-agent" : `${count} sub-agents`;

// With the sub-agents it waits on counted, where the place has room for it.
export function stateLabel(state: AgentState, subAgents: number): string {
  return state === "background" && subAgents > 0
    ? `Waiting on ${subAgentCount(subAgents)}`
    : STATE_LABELS[state];
}

// Status is a small icon, never a large fill (D-37): blue moves, amber asks, green is done.
export function StatusIcon({ state, size = 14 }: { state: AgentState; size?: number }) {
  const label = STATE_LABELS[state];
  switch (state) {
    case "starting":
    case "working":
      return (
        <LoaderCircle
          size={size}
          aria-label={label}
          className={`${styles.icon} ${styles.working} spin`}
        />
      );
    case "background":
      return (
        <CornerDownRight
          size={size}
          aria-label={label}
          className={`${styles.icon} ${styles.working}`}
        />
      );
    case "waiting":
      return <span role="img" aria-label={label} className={styles.dot} />;
    case "idle":
    case "done":
      return <Check size={size} aria-label={label} className={`${styles.icon} ${styles.ok}`} />;
    case "failed":
      return <X size={size} aria-label={label} className={`${styles.icon} ${styles.bad}`} />;
    case "stopped":
    case "interrupted":
      return (
        <CircleMinus size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />
      );
  }
}
