import { Check, CircleMinus, LoaderCircle, X } from "lucide-react";
import type { AgentState } from "../trace/progress.ts";
import styles from "./StatusIcon.module.css";

export const STATE_LABELS: Record<AgentState, string> = {
  starting: "Starting",
  working: "Working",
  waiting: "Needs you",
  idle: "Done",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

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
