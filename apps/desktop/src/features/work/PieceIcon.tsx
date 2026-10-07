import type { PieceStatus } from "@office-town/contract";
import { Check, CircleMinus, Clock, LoaderCircle, X } from "lucide-react";
import styles from "../../ui/StatusIcon.module.css";

const LABELS: Record<PieceStatus, string> = {
  waiting: "Waiting",
  queued: "Queued",
  working: "Working",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  dropped: "Dropped",
};

// A plan piece's or a thread's state as a small icon (D-37).
export function PieceIcon({ status, size = 14 }: { status: PieceStatus; size?: number }) {
  const label = LABELS[status];
  switch (status) {
    case "waiting":
    case "queued":
      return <Clock size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />;
    case "working":
      return (
        <LoaderCircle
          size={size}
          aria-label={label}
          className={`${styles.icon} ${styles.working} spin`}
        />
      );
    case "done":
      return <Check size={size} aria-label={label} className={`${styles.icon} ${styles.ok}`} />;
    case "failed":
      return <X size={size} aria-label={label} className={`${styles.icon} ${styles.bad}`} />;
    case "stopped":
    case "dropped":
      return (
        <CircleMinus size={size} aria-label={label} className={`${styles.icon} ${styles.quiet}`} />
      );
  }
}
