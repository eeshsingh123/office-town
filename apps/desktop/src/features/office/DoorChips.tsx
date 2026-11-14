import { Clock } from "lucide-react";
import { TaskStatusIcon } from "../tasks/TaskStatusIcon.tsx";
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
          <TaskStatusIcon status="working" size={11} />
          Working
        </span>
      );
    case "review":
      return (
        <span className={styles.chip}>
          <TaskStatusIcon status="review" size={11} />
          To review
          <span className={styles.unread} role="img" aria-label="unread" />
        </span>
      );
    case "queued":
      return (
        <span className={styles.chip}>
          <TaskStatusIcon status="queued" size={11} />
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
      return <span className={styles.chip}>Free</span>;
  }
}

// Small icons and dots, amber only for "needs you" (D-37).
export function DoorChips({ chips }: { chips: readonly DoorChip[] }) {
  return chips.map((chip) => <Chip key={chip.kind} chip={chip} />);
}
