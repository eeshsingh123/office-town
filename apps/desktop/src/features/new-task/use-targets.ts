import { useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";

// A department works on one goal at a time: its id and the goal it is busy with.
export function useBusyDepartments(): Map<string, string> {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const busy = new Map<string, string>();
  for (const { task, sessionIds } of Object.values(tasks)) {
    const working = sessionIds.some((id) => {
      const session = sessions[id];
      return session !== undefined && isOpen(session);
    });
    if (task.departmentId !== undefined && working) busy.set(task.departmentId, task.prompt);
  }
  return busy;
}
