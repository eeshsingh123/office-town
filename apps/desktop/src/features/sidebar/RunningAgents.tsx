import { taskStateOf, useTasksWithAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf, stageOf } from "../../trace/progress.ts";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
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
  if (tasks.length === 0) return null;

  return (
    <>
      <div className={styles.label}>Active</div>
      {tasks.map(({ task, agents }) => {
        const [first, ...others] = agents;
        const state = taskStateOf(agents, traces, waiting);
        if (first === undefined || state === undefined) return null;
        const trace = traces[first.latest.id];
        const step = trace === undefined ? undefined : progressOf(trace).step;
        const stage = others.length === 0 ? stageOf(state, trace) : undefined;
        const detail =
          stage !== undefined
            ? stage.charAt(0).toLowerCase() + stage.slice(1)
            : state === "working" && step !== undefined && others.length === 0
              ? `step ${step.number} of ${trace?.plan.length}`
              : STATE_LABELS[state].toLowerCase();
        const current = view.name === "task" && view.taskId === task.id;
        return (
          <button
            key={task.id}
            type="button"
            className={styles.task}
            aria-current={current ? "page" : undefined}
            onClick={() => navigate({ name: "task", taskId: task.id })}
          >
            <span className={styles.taskTitle}>
              <StatusIcon state={state} />
              <span>{taskTitle(task.prompt)}</span>
            </span>
            <span className={styles.taskMeta}>
              <WorkerName agent={first} others={others.length} /> · {detail}
            </span>
          </button>
        );
      })}
    </>
  );
}
