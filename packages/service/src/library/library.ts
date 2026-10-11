import type { AgentRecord, Attachment, LibraryItem, TaskRecord } from "@office-town/contract";
import type { Store } from "../store/store.ts";

// Given to everyone in the workspace, to the task's or the agent's department, or to the agent.
export function reaches(item: LibraryItem, task: TaskRecord, agent: AgentRecord): boolean {
  const { everyone, departmentIds, agentIds } = item.givenTo;
  if (item.workspaceId !== task.workspaceId) return false;
  return (
    everyone ||
    agentIds.includes(agent.id) ||
    [task.departmentId, agent.departmentId].some(
      (id) => id !== undefined && departmentIds.includes(id),
    )
  );
}

// A chief's goal has no workspace, so its own session gets none.
export function referenceOf(store: Store) {
  return (taskId: string, agentId: string): Attachment[] => {
    const task = store.getTask(taskId);
    const agent = store.getAgent(agentId);
    if (task?.workspaceId === undefined || agent === undefined) return [];
    return store
      .libraryOfWorkspace(task.workspaceId)
      .filter((item) => reaches(item, task, agent))
      .map((item) => item.file);
  };
}
