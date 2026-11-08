import type { SessionStatus, TaskSearch, TaskState, TaskTab } from "@office-town/contract";

// What a search needs of one task, read for every task at once.
export interface TaskFacts {
  ref: number;
  createdAt: number;
  state: TaskState;
  reviewed: number;
  isPart: number;
  isGroup: number;
  // Has an agent at work or a pause, so the app derives its status from the live run.
  live: number;
  openPieces: number;
  // The latest session of the agent that joined first: the solo agent or the lead.
  leadStatus: SessionStatus | null;
  leadAgentId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  leadDepartmentId: string | null;
  leadDepartmentName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  title: string | null;
  prompt: string;
  agentNames: string | null;
}

export interface TaskMatches {
  refs: number[];
  next?: string;
  counts: Record<TaskTab, number>;
  teams: string[];
  workspaceIds: string[];
}

type Status = "needs" | "working" | "queued" | "review" | "done" | "failed" | "stopped";

const TAB_STATUSES: Record<Exclude<TaskTab, "all">, Status[]> = {
  needs: ["needs"],
  active: ["working", "queued"],
  review: ["review"],
  done: ["done"],
  ended: ["failed", "stopped"],
};

// The same rule as the Tasks page, for a task with no agent at work.
function statusOf(task: TaskFacts): Status {
  switch (task.state) {
    case "waiting":
      return "needs";
    case "working":
      return "working";
    case "queued":
      return "queued";
    case "idle":
      if (task.openPieces) return "working";
      return task.leadStatus === "interrupted" ? "stopped" : "done";
    case "ended":
      if (task.leadStatus === "failed") return "failed";
      if (task.leadStatus === "stopped" || task.leadStatus === "interrupted") return "stopped";
      // A part reports to the chief, so only the whole goal waits for review.
      return task.reviewed || task.isPart ? "done" : "review";
  }
}

// A group task sits with its lead's department (D-63).
function teamOf(task: TaskFacts, chiefId: string | undefined): { key: string; name: string } {
  if (!task.isPart && chiefId !== undefined && task.leadAgentId === chiefId) {
    return { key: "chief", name: "" };
  }
  if (task.isGroup) {
    return { key: task.leadDepartmentId ?? "solo", name: task.leadDepartmentName ?? "" };
  }
  return { key: task.departmentId ?? "solo", name: task.departmentName ?? "" };
}

export function matchTasks(
  tasks: readonly TaskFacts[],
  filters: TaskSearch,
  chiefId: string | undefined,
): TaskMatches {
  const text = filters.text.trim().toLowerCase();
  const from = filters.from === undefined ? undefined : Date.parse(filters.from);
  const before = filters.before === undefined ? undefined : Date.parse(filters.before);
  const after = filters.cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(filters.cursor);
  const counts: Record<TaskTab, number> = {
    all: 0,
    needs: 0,
    active: 0,
    review: 0,
    done: 0,
    ended: 0,
  };
  const teams = new Set<string>();
  const workspaceIds = new Set<string>();
  const refs: number[] = [];
  let more = false;

  for (const task of tasks) {
    const team = teamOf(task, chiefId);
    teams.add(team.key);
    if (task.workspaceId !== null) workspaceIds.add(task.workspaceId);
    if (filters.teams.length > 0 && !filters.teams.includes(team.key)) continue;
    if (filters.workspaceId !== undefined && task.workspaceId !== filters.workspaceId) continue;
    if (from !== undefined && task.createdAt < from) continue;
    if (before !== undefined && task.createdAt >= before) continue;
    if (text !== "") {
      const haystack = [
        task.title,
        task.prompt,
        team.name,
        task.agentNames,
        task.workspaceName,
      ].join(" ");
      if (!haystack.toLowerCase().includes(text)) continue;
    }
    const status = statusOf(task);
    if (!task.live) {
      counts.all += 1;
      for (const [tab, statuses] of Object.entries(TAB_STATUSES)) {
        if (statuses.includes(status)) counts[tab as TaskTab] += 1;
      }
    }
    if (filters.tab !== "all" && !TAB_STATUSES[filters.tab].includes(status)) continue;
    if (task.ref >= after) continue;
    if (refs.length < filters.limit) refs.push(task.ref);
    else more = true;
  }
  const last = refs.at(-1);
  return {
    refs,
    ...(more && last !== undefined ? { next: String(last) } : {}),
    counts,
    teams: [...teams],
    workspaceIds: [...workspaceIds],
  };
}
