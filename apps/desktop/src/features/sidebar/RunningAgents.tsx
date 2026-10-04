import { stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import styles from "./Sidebar.module.css";

export function RunningAgents() {
  const agents = useAgents().filter((agent) => isOpen(agent.latest));
  const waiting = useWaitingSessions();
  const traces = useApp((state) => state.traces);
  const view = useApp((state) => state.view);
  if (agents.length === 0) return null;

  return (
    <>
      <div className={styles.label}>Active</div>
      {agents.map((agent) => {
        const state = stateOf(agent, traces, waiting.has(agent.latest.id));
        const trace = traces[agent.latest.id];
        const step = trace === undefined ? undefined : progressOf(trace).step;
        const detail =
          state === "working" && step !== undefined
            ? `step ${step.number} of ${trace?.plan.length}`
            : STATE_LABELS[state].toLowerCase();
        const current = view.name === "task" && view.taskId === agent.taskId;
        return (
          <button
            key={agent.taskId}
            type="button"
            className={styles.task}
            aria-current={current ? "page" : undefined}
            onClick={() => navigate({ name: "task", taskId: agent.taskId })}
          >
            <span className={styles.taskTitle}>
              <StatusIcon state={state} />
              <span>{taskTitle(agent.task.prompt)}</span>
            </span>
            <span className={styles.taskMeta}>
              {agent.name} · {detail}
            </span>
          </button>
        );
      })}
    </>
  );
}
