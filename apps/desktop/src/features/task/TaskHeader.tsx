import type { TaskRecord } from "@office-town/contract";
import type { ReactNode } from "react";
import { type Crumb, Crumbs } from "../../ui/Crumbs.tsx";
import { taskName } from "../../ui/format.ts";
import { OriginChip } from "../automations/OriginChip.tsx";
import { TaskStatusPill, useTaskStatus } from "../tasks/TaskStatusIcon.tsx";
import styles from "./TaskView.module.css";

// One header for every task page: where it sits, its title, its status once, then the page's
// controls (a3-1, a3-12). `after` is what follows the pill, such as Jump to it.
export function TaskHeader(props: {
  task: TaskRecord;
  crumbs: Crumb[];
  after?: ReactNode;
  children: ReactNode;
}) {
  const status = useTaskStatus(props.task.id, props.task);
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        <Crumbs items={props.crumbs} />
        <div className={styles.titleLine}>
          <h1 id="task-title">{taskName(props.task)}</h1>
          {status === undefined ? null : <TaskStatusPill status={status} />}
          <OriginChip task={props.task} />
          {props.after}
        </div>
      </div>
      {props.children}
    </header>
  );
}
