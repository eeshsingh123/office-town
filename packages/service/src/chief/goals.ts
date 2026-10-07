import { existsSync } from "node:fs";
import type {
  AgentRecord,
  DepartmentRecord,
  SessionRecord,
  TaskDetail,
} from "@office-town/contract";
import { settingsOf } from "../agents/agents.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { startFirstAgent } from "../task-start.ts";
import type { TeamContext } from "../team/members.ts";
import { harnessChoices, isClaimed, stopTeam } from "../team/team-tasks.ts";
import { chiefBrief, type DepartmentView } from "./briefs.ts";
import { chiefFolder, chiefOf, NoChiefError } from "./chief.ts";

function memberLine(store: Store, department: DepartmentRecord, member: AgentRecord): string {
  const { harness, model } = settingsOf(store, member);
  const role = member.id === department.leadAgentId ? "lead" : (member.role ?? "worker");
  const what = member.purpose ? `: ${member.purpose}` : "";
  return `${member.name}, ${role}${what} (${harness}${model ? `, ${model}` : ""})`;
}

function departmentViews(store: Store): DepartmentView[] {
  return store.listDepartments().map((department) => {
    const busy = store.activeTaskOf(department.id);
    return {
      name: department.name,
      members: store
        .listMembers(department.id)
        .map((member) => memberLine(store, department, member)),
      folders: store.getWorkspace(department.workspaceId)?.folders ?? [],
      busyWith: busy === undefined ? undefined : store.getTask(busy)?.prompt,
    };
  });
}

// As each workspace is when the goal starts; it changes none.
function departmentFolders(store: Store): string[] {
  const folders = store
    .listDepartments()
    .flatMap((department) => store.getWorkspace(department.workspaceId)?.folders ?? []);
  return [...new Set(folders)].filter((folder) => existsSync(folder));
}

async function startChief(
  context: TeamContext,
  chief: AgentRecord,
  taskId: string,
): Promise<SessionRecord> {
  const { store, registry, dataFolder } = context;
  const task = store.getTask(taskId);
  if (task === undefined) throw new RecordNotFoundError("task", taskId);
  return startFirstAgent(store, taskId, async () => {
    const folder = chiefFolder(dataFolder);
    const options = sessionOptionsFor(store, chief, {
      workspacePath: folder,
      readOnlyPaths: departmentFolders(store),
    });
    return registry.start({
      taskId,
      agentId: chief.id,
      options,
      message: chiefBrief({
        goal: task.prompt,
        folder,
        instructions: settingsOf(store, chief).instructions,
        departments: departmentViews(store),
        choices: await harnessChoices(context, options.environment),
      }),
    });
  });
}

// A goal given while another is running or queued is queued.
export async function startChiefGoal(context: TeamContext, goal: string): Promise<TaskDetail> {
  const { store } = context;
  const chief = chiefOf(store);
  if (chief === undefined) throw new NoChiefError();
  const waits =
    store.openTaskOfLead(chief.id) !== undefined ||
    isClaimed(chief.id) ||
    store.oldestQueuedTask() !== undefined;
  const task = store.createTask(goal, { leadAgentId: chief.id }, waits ? { queued: true } : {});
  if (!waits) await startChief(context, chief, task.id);
  const started = store.getTask(task.id);
  if (started === undefined) throw new RecordNotFoundError("task", task.id);
  return { task: started, sessions: store.listSessions(task.id) };
}

// A goal whose chief cannot start is deleted like any task that could not start.
export async function startQueuedGoal(context: TeamContext): Promise<void> {
  const { store } = context;
  const chief = chiefOf(store);
  if (chief === undefined) return;
  while (store.openTaskOfLead(chief.id) === undefined && !isClaimed(chief.id)) {
    const next = store.oldestQueuedTask();
    if (next === undefined) return;
    // Marked first, so a goal given meanwhile sees this one running and queues.
    store.setTaskState(next, "working");
    try {
      await startChief(context, chief, next);
    } catch (error) {
      console.error("Could not start the chief on its next goal.", error);
    }
  }
}

// Pieces close first, so no "stopped" result wakes the chief being stopped; unstarted ones are dropped.
export async function stopChiefGoal(context: TeamContext, taskId: string): Promise<void> {
  const { store } = context;
  if (store.getTask(taskId)?.state === "queued") {
    store.setTaskState(taskId, "ended");
    return;
  }
  const working = store.listPieces(taskId).flatMap((piece) => {
    if (piece.status === "waiting" || piece.status === "queued") {
      store.updatePiece(piece.id, { status: "dropped" });
    }
    if (piece.status !== "working") return [];
    store.updatePiece(piece.id, { status: "stopped" });
    return piece.pieceTaskId === undefined ? [] : [piece.pieceTaskId];
  });
  await Promise.all(working.map((pieceTaskId) => stopTeam(context, pieceTaskId)));
  await stopTeam(context, taskId);
}
