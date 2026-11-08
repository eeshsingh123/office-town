import type { TaskState, TaskTab } from "./api.ts";

// The Tasks page's status of a task. The core counts finished tasks by it, the app live ones.
export type TaskStatus = "needs" | "working" | "queued" | "review" | "done" | "failed" | "stopped";

export const TAB_STATUSES: Record<Exclude<TaskTab, "all">, readonly TaskStatus[]> = {
  needs: ["needs"],
  active: ["working", "queued"],
  review: ["review"],
  done: ["done"],
  ended: ["failed", "stopped"],
};

export const onTab = (status: TaskStatus, tab: TaskTab): boolean =>
  tab === "all" || TAB_STATUSES[tab].includes(status);

export interface StatusFacts {
  state: TaskState;
  reviewed: boolean;
  isPart: boolean;
  // A chief's goal with parts still to run.
  openPieces: boolean;
}

// `lead` is the latest state of the agent that joined first, the solo agent or the lead. Only
// "failed", "stopped" and "interrupted" change the outcome, words a session status and the app's
// agent state share.
export function taskStatus(task: StatusFacts, lead: string | undefined): TaskStatus {
  switch (task.state) {
    case "waiting":
      return "needs";
    case "working":
      return "working";
    case "queued":
      return "queued";
    case "idle":
      if (task.openPieces) return "working";
      return lead === "interrupted" ? "stopped" : "done";
    case "ended":
      if (lead === "failed") return "failed";
      if (lead === "stopped" || lead === "interrupted") return "stopped";
      // A part reports to the chief, so only the whole goal waits for review.
      return task.reviewed || task.isPart ? "done" : "review";
  }
}

export interface TeamFacts {
  isPart: boolean;
  isGroup: boolean;
  leadAgentId: string | undefined;
  // The lead's department, when it still stands.
  leadDepartmentId: string | undefined;
  departmentId: string | undefined;
}

// "chief", "solo" or a department id. A group task sits with its lead's department (D-63).
export function teamKey(task: TeamFacts, chiefId: string | undefined): string {
  if (!task.isPart && chiefId !== undefined && task.leadAgentId === chiefId) return "chief";
  if (task.isGroup) return task.leadDepartmentId ?? "solo";
  return task.departmentId ?? "solo";
}
