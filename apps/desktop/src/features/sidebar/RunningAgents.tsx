import { stateOf, useTasksWithAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import styles from "./Sidebar.module.css";

// The tasks with an agent at work: a team's task shows once, by its lead.
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
        if (first === undefined) return null;
        const asking = agents.find((agent) => waiting.has(agent.latest.id));
        const state = stateOf(asking ?? first, traces, asking !== undefined);
        const trace = traces[first.latest.id];
        const step = trace === undefined ? undefined : progressOf(trace).step;
        const detail =
          state === "working" && step !== undefined && others.length === 0
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
              {first.name}
              {others.length === 0 ? "" : ` and ${others.length} more`} · {detail}
            </span>
          </button>
        );
      })}
    </>
  );
}
