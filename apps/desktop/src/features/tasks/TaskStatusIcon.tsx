import { type TaskRecord, taskStatus } from "@office-town/contract";
import { CircleCheck, CircleMinus, CircleX, Clock, LoaderCircle } from "lucide-react";
import { useApp } from "../../store/app-store.ts";
import styles from "../../ui/StatusIcon.module.css";
import { type RowStatus, STATUS_LABELS, statusOfTask } from "./task-list.ts";

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

// The icon and the word, for rows outside Tasks that name a task's status.
export function TaskStatusTag({ status }: { status: RowStatus }) {
  return (
    <span className={styles.tag}>
      <TaskStatusIcon status={status} size={13} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// A task's live status, for screens that hold only the task. A task the app has not loaded is
// read from its record alone, as the core counts it.
export function TaskStatusOf({ taskId, task }: { taskId: string; task?: TaskRecord }) {
  const live = useApp((state) => statusOfTask(state, taskId));
  const status =
    live ??
    (task === undefined
      ? undefined
      : taskStatus(
          {
            state: task.state,
            reviewed: task.reviewedAt !== undefined,
            isPart: task.parentTaskId !== undefined,
            openPieces: false,
          },
          undefined,
        ));
  return status === undefined ? null : <TaskStatusTag status={status} />;
}
