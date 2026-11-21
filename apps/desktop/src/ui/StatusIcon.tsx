import { CircleDot, CircleMinus, LoaderCircle, X } from "lucide-react";
import type { AgentState, LiveState } from "../trace/progress.ts";
import styles from "./StatusIcon.module.css";

// Five words for an agent. Only a task or a part is ever "Done"; a finished agent is idle.
export const STATE_LABELS: Record<AgentState, string> = {
  starting: "Working",
  working: "Working",
  background: "Working",
  waiting: "Needs you",
  idle: "Idle",
  done: "Idle",
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

// Status is a small icon, never a large fill (D-37): blue moves, amber asks, green is idle, grey stopped.
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
      return <CircleDot size={size} aria-label={label} className={`${styles.icon} ${styles.ok}`} />;
    case "failed":
      return <X size={size} aria-label={label} className={`${styles.icon} ${styles.bad}`} />;
    case "stopped":
    case "interrupted":
      return (
        <CircleMinus size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />
      );
  }
}

const PILL_STATUS: Record<LiveState, string> = {
  working: "working",
  waiting: "needs",
  idle: "idle",
};

// A department's, a member's or the chief's one status, in the task page's pill (D-103).
export function StatePill({ state }: { state: LiveState }) {
  return (
    <span className={styles.pill} data-status={PILL_STATUS[state]}>
      <span className={styles.hover} aria-hidden>
        <StatusIcon state={state} size={13} />
      </span>
      {STATE_LABELS[state]}
    </span>
  );
}

// The same status as an icon and a word, for a row in a list.
export function StateTag({ state }: { state: LiveState }) {
  return (
    <span className={styles.tag}>
      <span className={styles.hover} aria-hidden>
        <StatusIcon state={state} size={13} />
      </span>
      {STATE_LABELS[state]}
    </span>
  );
}
