import { CircleCheck, CircleMinus, CircleX, Clock, LoaderCircle } from "lucide-react";
import styles from "../../ui/StatusIcon.module.css";
import { type RowStatus, STATUS_LABELS } from "./task-list.ts";

// A half-filled circle on the same 24-unit grid and ring as Done, so the two line up.
function HalfCircle({ size, label }: { size: number; label: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role="img"
      aria-label={label}
      className={`${styles.icon} ${styles.review}`}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A task's status, drawn the same in Tasks, on the Board and in its chat: amber asks, blue moves,
// violet waits for review, green is done, red failed, grey waits or stopped.
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
      return <HalfCircle size={size} label={label} />;
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
