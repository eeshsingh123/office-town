import type { EnvironmentSpec, SessionRecord, StartTeamTaskRequest } from "@office-town/contract";
import { listHarnesses } from "@office-town/harness";
import { createAgent, settingsOf } from "../agents/agents.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { type HarnessChoices, leadBrief, proposeTeamBrief } from "./briefs.ts";
import {
  DepartmentBusyError,
  memberOptions,
  rosterOf,
  type TeamContext,
  workspaceFolders,
} from "./members.ts";

// What a lead may choose from: each harness that can list its models where the lead runs.
export async function harnessChoices(
  { readCatalog }: TeamContext,
  environment: EnvironmentSpec,
): Promise<HarnessChoices[]> {
  const harnesses = listHarnesses();
  const catalogs = await Promise.allSettled(
    harnesses.map((harness) => readCatalog(harness.harness, environment)),
  );
  return harnesses.flatMap((harness, index) => {
    const catalog = catalogs[index];
    return catalog?.status === "fulfilled" ? [{ harness, models: catalog.value.models }] : [];
  });
}

// A goal for a saved department starts its lead with the team it has; a new lead first proposes
// one. Only the lead starts: it hands out the work.
export async function startTeamTask(
  context: TeamContext,
  { goal, team }: StartTeamTaskRequest,
): Promise<SessionRecord> {
  const { store, registry } = context;
  if ("departmentId" in team) {
    const department = store.getDepartment(team.departmentId);
    if (department === undefined) throw new RecordNotFoundError("department", team.departmentId);
    if (store.activeTaskOf(department.id) !== undefined) {
      throw new DepartmentBusyError(department.name);
    }
    const folders = workspaceFolders(store, department.workspaceId);
    const lead = store.getAgent(department.leadAgentId);
    if (lead === undefined) throw new RecordNotFoundError("agent", department.leadAgentId);
    const task = store.createTask(goal, { leadAgentId: lead.id, departmentId: department.id });
    return registry.start({
      taskId: task.id,
      agentId: lead.id,
      options: memberOptions(store, lead, folders, department.autonomy),
      message: leadBrief({
        goal,
        teamName: department.name,
        folders,
        instructions: settingsOf(store, lead).instructions,
        roster: rosterOf(store, department),
      }),
    });
  }
  const folders = workspaceFolders(store, team.workspaceId);
  const lead = createAgent(store, team.lead, "Lead");
  const options = memberOptions(store, lead, folders, team.autonomy);
  const task = store.createTask(goal, {
    leadAgentId: lead.id,
    setup: { workspaceId: team.workspaceId, autonomy: team.autonomy },
  });
  return registry.start({
    taskId: task.id,
    agentId: lead.id,
    options,
    message: proposeTeamBrief({
      goal,
      folders,
      instructions: settingsOf(store, lead).instructions,
      choices: await harnessChoices(context, options.environment),
    }),
  });
}
