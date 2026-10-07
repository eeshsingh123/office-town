import { randomUUID } from "node:crypto";
import type {
  DepartmentRecord,
  EnvironmentSpec,
  ProposalPlace,
  Team,
  TeamRole,
} from "@office-town/contract";
import { z } from "zod";
import { AnswerError, type CoreRequestHandler } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { leadsTeam } from "./lead.ts";
import { applyTeam, checkTeam, rosterOf, type TeamContext, TeamError } from "./members.ts";

const MODELS_NAMED = 20;

const roleSchema = z.object({
  role: z.string().min(1).describe("The role, such as Frontend developer."),
  purpose: z.string().min(1).describe("What this worker does, in a few words."),
  harness: z.string().min(1).describe('The harness it runs on, such as "claude" or "opencode".'),
  model: z.string().min(1).optional().describe("A model of that harness; its default if left out."),
  effort: z.string().min(1).optional().describe("An effort value of that model."),
  keep: z
    .string()
    .optional()
    .describe("To keep a worker the team already has, its name, such as @ben-1042."),
});

const inputSchema = z.object({
  name: z.string().min(1).describe("A short name for the team, such as Web team."),
  roles: z.array(roleSchema).min(1).describe("The workers. You lead them and are not one."),
  reason: z.string().optional().describe("Why this team, in a sentence or two, for the user."),
});

type ProposedRole = z.infer<typeof roleSchema>;

// Checked against what is installed here, so the lead learns of a wrong name at once.
export async function checkedSettings(
  { readCatalog }: TeamContext,
  proposed: Pick<ProposedRole, "harness" | "model" | "effort">,
  environment: EnvironmentSpec,
) {
  const catalog = await readCatalog(proposed.harness, environment).catch(() => {
    throw new ToolError(`The harness "${proposed.harness}" is not available on this computer.`);
  });
  const model =
    proposed.model === undefined
      ? undefined
      : catalog.models.find((known) => known.id === proposed.model);
  if (proposed.model !== undefined && model === undefined) {
    const named = catalog.models.slice(0, MODELS_NAMED).map((known) => known.id);
    throw new ToolError(
      `"${proposed.model}" is not a model of ${proposed.harness} here. Some that are: ${named.join(", ")}.`,
    );
  }
  if (proposed.effort !== undefined && !model?.efforts.includes(proposed.effort)) {
    const offered = model?.efforts.join(", ") || "none";
    throw new ToolError(
      `"${proposed.effort}" is not an effort of that model (it offers ${offered}).`,
    );
  }
  return {
    harness: proposed.harness,
    environment,
    ...(proposed.model === undefined ? {} : { model: proposed.model }),
    ...(proposed.effort === undefined ? {} : { effort: proposed.effort }),
  };
}

function placeOf(
  context: TeamContext,
  caller: Caller,
): {
  place: ProposalPlace;
  department: DepartmentRecord | undefined;
} {
  const { store } = context;
  const task = store.getTask(caller.taskId);
  const department =
    task?.departmentId === undefined ? undefined : store.getDepartment(task.departmentId);
  const setup = store.taskSetup(caller.taskId);
  const workspaceId = department?.workspaceId ?? setup?.workspaceId;
  const autonomy = department?.autonomy ?? setup?.autonomy;
  const workspace = store.listWorkspaces().find((known) => known.id === workspaceId);
  if (workspace === undefined || autonomy === undefined) {
    throw new ToolError("This task has no team to propose for.");
  }
  return {
    place: { workspaceName: workspace.name, folders: workspace.folders, autonomy },
    department,
  };
}

// Approving saves the department and makes its agents; for a team that exists, it applies the
// change. Either way the task now belongs to that department.
function approve(context: TeamContext, caller: Caller, team: Team): DepartmentRecord {
  const { store } = context;
  const task = store.getTask(caller.taskId);
  if (task === undefined) throw new RecordNotFoundError("task", caller.taskId);
  if (task.departmentId !== undefined) {
    const department = store.getDepartment(task.departmentId);
    if (department === undefined) throw new RecordNotFoundError("department", task.departmentId);
    checkTeam(store, department, team);
    const named = store.updateDepartment(department.id, { ...department, name: team.name });
    applyTeam(store, named, team);
    return named;
  }
  const setup = store.taskSetup(caller.taskId);
  const lead = store.getAgent(caller.agentId);
  if (setup === undefined || lead === undefined) throw new TeamError("This task has no team.");
  checkTeam(store, undefined, team);
  const department = store.createDepartment({
    name: team.name,
    workspaceId: setup.workspaceId,
    autonomy: setup.autonomy,
    leadAgentId: lead.id,
    branchPerWorker: true,
    codeFlow: false,
  });
  store.updateAgent(lead.id, { ...lead, departmentId: department.id });
  applyTeam(store, department, team);
  store.joinDepartment(caller.taskId, department.id);
  return department;
}

function answerProposal(
  context: TeamContext,
  caller: Caller,
  requestId: string,
): CoreRequestHandler {
  const { store, registry } = context;
  const tell = (text: string, summary: string) => () =>
    registry.tell(caller.sessionId, { text, origin: { kind: "notice", summary } });
  return (command) => {
    if (command.type !== "answerProposal") throw new AnswerError("This is a team proposal.");
    const { answer } = command;
    if (answer.outcome === "approved") {
      const department = approve(context, caller, answer.team);
      const roles = answer.team.roles.map((role) => role.role).join(", ");
      return {
        resolution: {
          type: "proposal.resolved",
          payload: { requestId, outcome: "approved", team: answer.team },
        },
        afterwards: tell(
          `The user approved your team, ${department.name}. Your workers:\n${rosterOf(store, department)}\n\nHand out the work with the delegate tool.`,
          `You approved the team: ${roles}`,
        ),
      };
    }
    const resolution = {
      type: "proposal.resolved",
      payload: {
        requestId,
        outcome: answer.outcome,
        ...(answer.note ? { note: answer.note } : {}),
      },
    } as const;
    if (answer.outcome === "revised") {
      return {
        resolution,
        afterwards: tell(
          `The user sent your proposal back with this note: "${answer.note}". Propose again with propose_team.`,
          "Your proposal went back with a note",
        ),
      };
    }
    return {
      resolution,
      afterwards: tell(
        `The user declined the change to the team${answer.note ? `: "${answer.note}"` : ""}. The team stays as it is.`,
        "You declined the change to the team",
      ),
    };
  };
}

// The lead's first step for a new team, and how it changes its team later; every proposal is
// approved, edited or sent back by the user in Needs you (D-40).
export function proposeTeam(context: TeamContext) {
  const { store, registry } = context;
  return defineTool({
    name: "propose_team",
    description:
      "Propose your team to the user: a name and the workers you need. To change a team you " +
      "have, propose the whole new team, keeping current workers by name. It returns at once; " +
      "the user's answer reaches you later as a message.",
    input: inputSchema,
    offeredTo: (caller) => leadsTeam(store, caller),
    async call({ name, roles, reason }, caller) {
      const waiting = store
        .listPendingRequests()
        .requests.some(
          ({ event }) =>
            event.sessionId === caller.sessionId && event.type === "proposal.requested",
        );
      if (waiting) throw new ToolError("Your last proposal is still with the user.");
      const { place, department } = placeOf(context, caller);
      const environment = store.getSession(caller.sessionId)?.options.environment;
      if (environment === undefined) throw new RecordNotFoundError("session", caller.sessionId);
      const members = department === undefined ? [] : store.listMembers(department.id);
      const team: Team = { name, roles: [] };
      for (const proposed of roles) {
        const kept = members.find((member) => member.name === proposed.keep);
        if (proposed.keep !== undefined && kept === undefined) {
          throw new ToolError(`${proposed.keep} is not on your team.`);
        }
        const role: TeamRole = {
          role: proposed.role,
          purpose: proposed.purpose,
          settings: await checkedSettings(context, proposed, environment),
          ...(kept === undefined ? {} : { agentId: kept.id }),
        };
        team.roles.push(role);
      }
      const requestId = `proposal-${randomUUID()}`;
      registry.ask(
        caller.sessionId,
        {
          type: "proposal.requested",
          payload: {
            requestId,
            team,
            place,
            ...(reason === undefined ? {} : { reason }),
            ...(department === undefined ? {} : { departmentId: department.id }),
          },
        },
        answerProposal(context, caller, requestId),
      );
      return "Your proposal is with the user. Their answer will reach you as a message; do not start the work before then.";
    },
  });
}
