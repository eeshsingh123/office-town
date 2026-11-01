import { useApp } from "../../store/app-store.ts";

// A department works on one goal at a time: its id and the goal it is busy with. The core's rule:
// free once the task ends, which a resting agent or an open check changes (D-84).
export function useBusyDepartments(): Map<string, string> {
  const tasks = useApp((state) => state.tasks);
  const busy = new Map<string, string>();
  for (const { task } of Object.values(tasks)) {
    if (task.departmentId !== undefined && task.state !== "ended") {
      busy.set(task.departmentId, task.prompt);
    }
  }
  return busy;
}
