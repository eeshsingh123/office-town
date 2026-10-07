import type { EnvironmentSpec, SessionRecord, StartTeamTaskRequest } from "@office-town/contract";
import { listHarnesses } from "@office-town/harness";
import { createAgent, settingsOf } from "../agents/agents.ts";
import { inFolders, sessionOptionsFor } from "../agents/options.ts";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { type HarnessChoices, leadBrief, proposeTeamBrief } from "./briefs.ts";
import { isOpen, latestSession } from "./lead.ts";
import {
  DepartmentBusyError,
  rosterOf,
  type TeamContext,
  TeamError,
  workspaceFolders,
} from "./members.ts";
import { isRepository } from "./worktrees.ts";

const SHOWN_BRIEF = 120;

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

// A department works on one goal at a time (D-41): a goal starts, or is taken up again, only once
// every other has ended. Agents its ended goals left open are then stopped as idle, to be resumed
// if their goal is taken up again.
export async function claimDepartment(
  { store, registry }: TeamContext,
  departmentId: string | undefined,
  taskId?: string,
): Promise<void> {
  if (departmentId === undefined) return;
  const active = store.activeTaskOf(departmentId);
  if (active !== undefined && active !== taskId) {
    throw new DepartmentBusyError(store.getDepartment(departmentId)?.name ?? "The department");
  }
  const leftOpen = store
    .listActiveTasks()
    .filter((task) => task.departmentId === departmentId && task.id !== taskId)
    .flatMap((task) => task.sessions.filter(isOpen));
  const stops = await Promise.allSettled(
    leftOpen.map((session) => registry.stop(session.id, true)),
  );
  throwUnlessStopped(stops, "Some agents of an earlier goal could not be stopped.");
}

// An agent that ended on its own in the meantime has nothing left to stop.
function throwUnlessStopped(stops: PromiseSettledResult<void>[], message: string): void {
  const failures = stops.flatMap((stop) =>
    stop.status === "rejected" && !(stop.reason instanceof SessionNotRunningError)
      ? [stop.reason]
      : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, message);
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
    await claimDepartment(context, department.id);
    const folders = workspaceFolders(store, department.workspaceId);
    const lead = store.getAgent(department.leadAgentId);
    if (lead === undefined) throw new RecordNotFoundError("agent", department.leadAgentId);
    const task = store.createTask(goal, { leadAgentId: lead.id, departmentId: department.id });
    return registry.start({
      taskId: task.id,
      agentId: lead.id,
      options: sessionOptionsFor(store, lead, inFolders(folders)),
      message: leadBrief({
        goal,
        teamName: department.name,
        folders,
        instructions: settingsOf(store, lead).instructions,
        roster: rosterOf(store, department),
        branches: department.branchPerWorker && isRepository(folders[0] ?? ""),
        codeFlow: department.codeFlow,
      }),
    });
  }
  const folders = workspaceFolders(store, team.workspaceId);
  const lead = createAgent(store, team.lead, { role: "Lead", autonomy: team.autonomy });
  const options = sessionOptionsFor(store, lead, inFolders(folders));
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

// Stops every member at work on the task. Their delegations are closed first, so no "stopped"
// result wakes the lead the user is stopping too.
export async function stopTeam({ store, registry }: TeamContext, taskId: string): Promise<void> {
  for (const delegation of store.listDelegations(taskId)) {
    if (delegation.status === "working") store.endDelegation(delegation.id, "stopped");
  }
  const stops = await Promise.allSettled(
    store
      .listSessions(taskId)
      .filter(isOpen)
      .map((session) => registry.stop(session.id)),
  );
  throwUnlessStopped(stops, "Some members could not be stopped.");
}

// After a restart a team's task is interrupted. Continuing resumes its lead, told which pieces of
// work were cut off, so it can hand them out again (MODULES M4.5).
export async function continueTeam(
  context: TeamContext,
  taskId: string,
  prompt: string | undefined,
): Promise<SessionRecord> {
  const { store, registry } = context;
  const task = store.getTask(taskId);
  if (task === undefined) throw new RecordNotFoundError("task", taskId);
  if (task.leadAgentId === undefined) throw new TeamError("This task has no team to continue.");
  const lead = latestSession(context, taskId, task.leadAgentId);
  if (lead === undefined) throw new TeamError("This task's lead never started.");
  if (isOpen(lead)) throw new TeamError("The lead is already at work.");
  await claimDepartment(context, task.departmentId, taskId);
  const cut = store.listDelegations(taskId).filter((one) => one.status === "interrupted");
  for (const delegation of cut) store.endDelegation(delegation.id, "stopped");
  const added = prompt === undefined || prompt === "" ? "" : `\n\nThe user adds: ${prompt}`;
  if (cut.length === 0) {
    return registry.resume(lead.id, { text: prompt || "Continue where you left off." });
  }
  const lines = cut.map((delegation) => {
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const brief =
      delegation.brief.length > SHOWN_BRIEF
        ? `${delegation.brief.slice(0, SHOWN_BRIEF)}…`
        : delegation.brief;
    return `- ${name}: ${brief}`;
  });
  return registry.resume(lead.id, {
    text: `Office Town was closed while your team worked, and this work was cut off before it finished:\n${lines.join("\n")}\n\nHand it out again with delegate if it is still needed.${added}`,
    origin: { kind: "notice", summary: `Work cut off by a restart: ${cut.length}` },
  });
}
