import type {
  AgentRecord,
  DepartmentDraft,
  DepartmentDraftReply,
  DepartmentDraftRequest,
  DraftPerson,
  RoleSettings,
} from "@office-town/contract";
import { z } from "zod";
import { RecordNotFoundError } from "../store/store.ts";
import { describeChoices, type HarnessChoices } from "../team/briefs.ts";
import type { TeamContext } from "../team/members.ts";
import { harnessChoices } from "../team/team-tasks.ts";
import { askForJson } from "./run.ts";
import {
  ASKING,
  asked,
  numbered,
  settingsOf,
  type WrittenPerson,
  writtenPersonSchema,
  writtenReplyShape,
} from "./written.ts";

const writtenDepartmentsSchema = z.object({
  ...writtenReplyShape,
  departments: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        purpose: z.string().default(""),
        rules: z.string().default(""),
        lead: writtenPersonSchema,
        members: z.array(writtenPersonSchema).default([]),
      }),
    )
    .default([]),
});

const PERSON = `{"role":"...","purpose":"...","instructions":"...","harness":"...","model":"...","effort":"...","model_from_user":false,"agent_id":"..."}`;

function personOf(agent: AgentRecord): DraftPerson {
  const { harness, environment, model, effort, instructions } = agent.settings;
  return {
    role: agent.role ?? "Member",
    purpose: agent.purpose ?? "",
    instructions: instructions ?? "",
    settings: {
      harness,
      environment,
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    },
    agentId: agent.id,
  };
}

// The department as it is now, to change in words.
function draftOfDepartment({ store }: TeamContext, departmentId: string): DepartmentDraft {
  const department = store.getDepartment(departmentId);
  if (department === undefined) throw new RecordNotFoundError("department", departmentId);
  const members = store.listMembers(departmentId);
  const lead = members.find((member) => member.id === department.leadAgentId);
  if (lead === undefined) throw new RecordNotFoundError("agent", department.leadAgentId);
  const { agentId: _, ...leadPerson } = personOf(lead);
  return {
    departmentId,
    name: department.name,
    purpose: department.purpose ?? "",
    rules: department.rules ?? "",
    lead: leadPerson,
    members: members.filter((member) => member.id !== lead.id).map(personOf),
  };
}

function promptFor(
  request: DepartmentDraftRequest,
  current: DepartmentDraft[] | undefined,
  choices: HarnessChoices[],
): string {
  const changing = current?.some((draft) => draft.departmentId !== undefined)
    ? "\n- You are changing a department that exists. Keep agent_id on every member who stays; leave it out for new members."
    : "";
  const draft =
    current === undefined
      ? ""
      : `\n\nThe current draft; change only what the user asks:\n${JSON.stringify(current)}`;
  return `You help a user of Office Town set up departments: teams of AI agents. Each department has one lead, who splits each task among its members, and any number of members. Each person runs on a harness (an AI app) with a model.

Write the departments the user describes. Reply with one JSON object and nothing else:
{"questions":[{"question":"...","options":["..."]}],"suggestions":["..."],"departments":[{"name":"...","purpose":"...","rules":"...","lead":PERSON,"members":[PERSON]}]}
PERSON is ${PERSON}

- Keep every detail the user gave: how many people, who leads, roles, models, tone.
- name: a short team name. purpose: one line on what the department is for. rules: rules every member follows, only if the user gave some or they plainly follow from the work; else "".
- role: a short job title. purpose: one line on what they do. instructions: 3 to 6 short lines addressed to them: how they work, what to avoid, what to hand back. The lead's instructions say how to split the work and what to check before handing it back.
- Pick harness, model and effort from the list below. When the user did not name a model, pick one that fits the job, prefer free or plan models for routine work, and set model_from_user to false. Leave effort out unless it matters.
- Write more than one department only when the user asks for more than one.${changing}
${ASKING}

Harnesses and models:
${describeChoices(choices)}${draft}

What the user said, in order:
${numbered(request.notes)}`;
}

function toDraft(
  written: z.infer<typeof writtenDepartmentsSchema>["departments"][number],
  base: DepartmentDraft | undefined,
  members: AgentRecord[],
  choices: HarnessChoices[],
  drafter: RoleSettings,
): DepartmentDraft {
  const person = (one: WrittenPerson, keepable: boolean): DraftPerson => {
    const kept = keepable ? members.find((member) => member.id === one.agent_id) : undefined;
    return {
      role: one.role,
      purpose: one.purpose.trim(),
      instructions: one.instructions.trim(),
      ...settingsOf(one, choices, drafter),
      ...(kept === undefined ? {} : { agentId: kept.id }),
    };
  };
  return {
    ...(base?.departmentId === undefined ? {} : { departmentId: base.departmentId }),
    name: written.name,
    purpose: written.purpose.trim(),
    rules: written.rules.trim(),
    lead: person(written.lead, false),
    members: written.members.map((member) => person(member, true)),
  };
}

export async function draftDepartments(
  context: TeamContext,
  request: DepartmentDraftRequest,
): Promise<DepartmentDraftReply> {
  const current =
    request.current ??
    (request.departmentId === undefined
      ? undefined
      : [draftOfDepartment(context, request.departmentId)]);
  const choices = await harnessChoices(context, request.drafter.environment);
  const written = await askForJson(
    context,
    request.drafter,
    promptFor(request, current, choices),
    writtenDepartmentsSchema,
  );
  // Kept members must be workers of the department being changed, never anyone else.
  const changing = current?.find((draft) => draft.departmentId !== undefined);
  const department =
    changing?.departmentId === undefined
      ? undefined
      : context.store.getDepartment(changing.departmentId);
  const members =
    department === undefined
      ? []
      : context.store
          .listMembers(department.id)
          .filter((member) => member.id !== department.leadAgentId);
  return {
    ...asked(written),
    departments: written.departments.map((each, index) =>
      toDraft(each, index === 0 ? changing : undefined, members, choices, request.drafter),
    ),
  };
}
