import { useShallow } from "zustand/react/shallow";
import { taskStateOf, useTasksWithAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf, stageOf } from "../../trace/progress.ts";
import { ContextMenu } from "../../ui/ActionMenu.tsx";
import { taskName } from "../../ui/format.ts";
import { TaskStatusIcon } from "../tasks/TaskStatusIcon.tsx";
import { STATUS_LABELS, statusOfTask } from "../tasks/task-list.ts";
import { taskMenu } from "../tasks/task-menu.ts";
import { WorkerName } from "../tasks/WorkerName.tsx";
import styles from "./Sidebar.module.css";

// A team's task shows once, by its lead.
export function RunningAgents() {
  const tasks = useTasksWithAgents().filter((entry) =>
    entry.agents.some((agent) => isOpen(agent.latest)),
  );
  const waiting = useWaitingSessions();
  const traces = useApp((state) => state.traces);
  const view = useApp((state) => state.view);
  const statuses = useApp(
    useShallow((state) => tasks.map(({ task }) => statusOfTask(state, task.id))),
  );
  if (tasks.length === 0) return null;

  return (
    <>
      <div className={styles.label}>Active</div>
      {tasks.map(({ task, agents }, index) => {
        const [first, ...others] = agents;
        const state = taskStateOf(agents, traces, waiting);
        const status = statuses[index];
        if (first === undefined || state === undefined || status === undefined) return null;
        const trace = traces[first.latest.id];
        const step = trace === undefined ? undefined : progressOf(trace).step;
        const stage = others.length === 0 ? stageOf(state, trace) : undefined;
        const detail =
          stage !== undefined
            ? stage.charAt(0).toLowerCase() + stage.slice(1)
            : state === "working" && step !== undefined && others.length === 0
              ? `step ${step.number} of ${trace?.plan.length}`
              : STATUS_LABELS[status].toLowerCase();
        const current = view.name === "task" && view.taskId === task.id;
        return (
          <ContextMenu key={task.id} menu={() => taskMenu(task.id)}>
            <button
              type="button"
              className={styles.task}
              aria-current={current ? "page" : undefined}
              onClick={() => navigate({ name: "task", taskId: task.id })}
            >
              <span className={styles.taskTitle}>
                <TaskStatusIcon status={status} />
                <span>{taskName(task)}</span>
              </span>
              <span className={styles.taskMeta}>
                <WorkerName agent={first} others={others.length} /> · {detail}
              </span>
            </button>
          </ContextMenu>
        );
      })}
    </>
  );
}
