import type {
  DepartmentRecord,
  DepartmentSettings,
  NewDepartmentRequest,
  Team,
} from "@office-town/contract";
import { createAgent } from "../agents/agents.ts";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { applyTeam, checkTeam, rosterOf, type TeamContext, workspaceFolders } from "./members.ts";

function departmentOf({ store }: TeamContext, id: string): DepartmentRecord {
  const department = store.getDepartment(id);
  if (department === undefined) throw new RecordNotFoundError("department", id);
  return department;
}

// A lead not at work learns the team from its next brief, so it is not woken just to be told.
async function tellLead(
  { store, registry }: TeamContext,
  department: DepartmentRecord,
  text: string,
  summary: string,
): Promise<void> {
  const taskId = store.activeTaskOf(department.id);
  if (taskId === undefined) return;
  const session = store
    .listSessions(taskId)
    .findLast(
      (candidate) =>
        candidate.agentId === department.leadAgentId &&
        (candidate.status === "starting" || candidate.status === "running"),
    );
  if (session === undefined) return;
  try {
    await registry.tell(session.id, { text, origin: { kind: "notice", summary } });
  } catch (error) {
    // A lead stopped meanwhile can still read its team with team_status.
    if (!(error instanceof SessionNotRunningError)) throw error;
  }
}

export function createDepartment(
  context: TeamContext,
  { team, workspaceId, autonomy, lead: newLead }: NewDepartmentRequest,
): DepartmentRecord {
  const { store } = context;
  workspaceFolders(store, workspaceId);
  checkTeam(store, undefined, team);
  const lead = createAgent(store, newLead, { role: "Lead", autonomy });
  const department = store.createDepartment({
    name: team.name,
    workspaceId,
    autonomy,
    leadAgentId: lead.id,
    branchPerWorker: true,
    codeFlow: false,
  });
  store.updateAgent(lead.id, { ...lead, departmentId: department.id });
  applyTeam(store, department, team);
  return department;
}

export async function changeTeam(
  context: TeamContext,
  departmentId: string,
  team: Team,
): Promise<DepartmentRecord> {
  const { store } = context;
  const current = departmentOf(context, departmentId);
  checkTeam(store, current, team);
  const department = store.updateDepartment(departmentId, { ...current, name: team.name });
  const { added, removed, updated } = applyTeam(store, department, team);
  const changes = [
    ...added.map((agent) => `${agent.name} joined as ${agent.role}`),
    ...removed.map((agent) => `${agent.name} left`),
    ...updated.map((agent) => `${agent.name} is now ${agent.role}`),
  ];
  // A save that left the team as it was does not cost the lead a turn.
  if (changes.length === 0) return department;
  await tellLead(
    context,
    department,
    `The user changed your team: ${changes.join("; ")}. Your workers now:\n${rosterOf(store, department)}`,
    `You changed the team: ${changes.join("; ")}`,
  );
  return department;
}

export function updateDepartment(
  context: TeamContext,
  departmentId: string,
  settings: DepartmentSettings,
): DepartmentRecord {
  departmentOf(context, departmentId);
  return context.store.updateDepartment(departmentId, settings);
}
