import { CircleCheck, CircleMinus, CircleX, Clock, Contrast, LoaderCircle } from "lucide-react";
import styles from "../../ui/StatusIcon.module.css";
import { type RowStatus, STATUS_LABELS } from "./task-list.ts";

// A task's status, drawn the same in Tasks, on the Board and in its chat: amber asks, blue moves,
// green is finished (half while it waits for review), red failed, grey waits or stopped.
export function TaskStatusIcon({ status, size = 14 }: { status: RowStatus; size?: number }) {
  const label = STATUS_LABELS[status];
  switch (status) {
    case "needs":
      return <span role="img" aria-label={label} className={styles.dot} />;
    case "working":
      return (
        <LoaderCircle
          size={size}
          aria-label={label}
          className={`${styles.icon} ${styles.working} spin`}
        />
      );
    case "queued":
      return <Clock size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />;
    case "review":
      return <Contrast size={size} aria-label={label} className={`${styles.icon} ${styles.ok}`} />;
    case "done":
      return (
        <CircleCheck size={size} aria-label={label} className={`${styles.icon} ${styles.ok}`} />
      );
    case "stopped":
      return (
        <CircleMinus size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />
      );
    case "failed":
      return <CircleX size={size} aria-label={label} className={`${styles.icon} ${styles.bad}`} />;
  }
}
