import { Clock, Eye, LoaderCircle } from "lucide-react";
import type { DoorChip } from "./doors.ts";
import styles from "./Office.module.css";

function Chip({ chip }: { chip: DoorChip }) {
  switch (chip.kind) {
    case "needs-you":
      return (
        <span className={`${styles.chip} ${styles.chipNeeds}`}>
          <span className={styles.chipDot} aria-hidden />
          {chip.count} {chip.count === 1 ? "needs" : "need"} you
        </span>
      );
    case "working":
      return (
        <span className={styles.chip}>
          <LoaderCircle size={11} className={`${styles.running} spin`} aria-hidden />
          Working
        </span>
      );
    case "review":
      return (
        <span className={styles.chip}>
          <Eye size={11} className={styles.ok} aria-hidden />
          To review
          <span className={styles.unread} role="img" aria-label="unread" />
        </span>
      );
    case "queued":
      return (
        <span className={styles.chip}>
          <Clock size={11} aria-hidden />
          Queued
        </span>
      );
    case "waits-on":
      return (
        <span className={styles.chip}>
          <Clock size={11} aria-hidden />
          Waits on {chip.department}
        </span>
      );
    case "idle":
      return <span className={styles.chip}>Idle</span>;
  }
}

// Small icons and dots, amber only for "needs you" (D-37).
export function DoorChips({ chips }: { chips: readonly DoorChip[] }) {
  return chips.map((chip) => <Chip key={chip.kind} chip={chip} />);
}
