import { useApp } from "../../store/app-store.ts";
import styles from "./Outputs.module.css";
import { useResults } from "./use-task-outputs.ts";

// Switching tabs or results replaces the view, so Back leaves the task instead of stepping through
// them.
function show(taskId: string, outputs: boolean, output?: string): void {
  useApp.setState({
    view: {
      name: "task",
      taskId,
      ...(outputs ? { tab: "outputs" as const } : {}),
      ...(output === undefined ? {} : { output }),
    },
  });
}

export function useTaskTab(taskId: string) {
  const view = useApp((state) => state.view);
  const here = view.name === "task" && view.taskId === taskId ? view : undefined;
  return {
    outputs: here?.tab === "outputs",
    output: here?.output,
    choose: (output: string | undefined) => show(taskId, true, output),
  };
}

export function TaskTabs({ taskId }: { taskId: string }) {
  const { outputs } = useTaskTab(taskId);
  const count = useResults(taskId).length;
  return (
    <fieldset className={styles.segment}>
      <legend className="visually-hidden">Show</legend>
      <button type="button" aria-pressed={!outputs} onClick={() => show(taskId, false)}>
        Work
      </button>
      <button type="button" aria-pressed={outputs} onClick={() => show(taskId, true)}>
        Outputs
        {count === 0 ? null : <span className={styles.tabCount}>{count}</span>}
      </button>
    </fieldset>
  );
}
