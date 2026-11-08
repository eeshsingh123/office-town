import {
  onTab,
  type SessionStatus,
  type TaskSearch,
  type TaskState,
  type TaskTab,
  taskStatus,
  teamKey,
} from "@office-town/contract";

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
  // Read only while text is typed.
  prompt: string | null;
  agentNames: string | null;
}

export interface TaskMatches {
  refs: number[];
  next?: string;
  counts: Record<TaskTab, number>;
  teams: string[];
  workspaceIds: string[];
}

const orUndefined = <T>(value: T | null) => value ?? undefined;

function teamOf(task: TaskFacts, chiefId: string | undefined): { key: string; name: string } {
  const key = teamKey(
    {
      isPart: task.isPart === 1,
      isGroup: task.isGroup === 1,
      leadAgentId: orUndefined(task.leadAgentId),
      leadDepartmentId: orUndefined(task.leadDepartmentId),
      departmentId: orUndefined(task.departmentId),
    },
    chiefId,
  );
  const name = task.isGroup ? task.leadDepartmentName : task.departmentName;
  return { key, name: key === "chief" || key === "solo" ? "" : (name ?? "") };
}

function matchesText(task: TaskFacts, team: { key: string; name: string }, filters: TaskSearch) {
  const text = filters.text.trim().toLowerCase();
  if (text === "" || filters.textTeams.includes(team.key)) return true;
  const haystack = [task.title, task.prompt, team.name, task.agentNames, task.workspaceName];
  return haystack.join(" ").toLowerCase().includes(text);
}

export function matchTasks(
  tasks: readonly TaskFacts[],
  filters: TaskSearch,
  chiefId: string | undefined,
): TaskMatches {
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
    if (!matchesText(task, team, filters)) continue;
    const status = taskStatus(
      {
        state: task.state,
        reviewed: task.reviewed === 1,
        isPart: task.isPart === 1,
        openPieces: task.openPieces === 1,
      },
      orUndefined(task.leadStatus),
    );
    if (!task.live) {
      for (const tab of Object.keys(counts) as TaskTab[]) {
        if (onTab(status, tab)) counts[tab] += 1;
      }
    }
    if (!onTab(status, filters.tab) || task.ref >= after) continue;
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
