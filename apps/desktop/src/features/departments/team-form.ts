import {
  type AgentRecord,
  type Autonomy,
  agentColours,
  type DepartmentDraft,
  type DepartmentRecord,
  type DraftPerson,
  type RoleSettings,
  type Team,
  type TeamRole,
} from "@office-town/contract";

// One person on the team while it is edited; the lead is one too.
export interface PersonForm {
  key: number;
  role: string;
  purpose: string;
  instructions: string;
  settings: RoleSettings;
  // A member the department already has.
  agentId?: string;
  // The template it was filled in from.
  profileId?: string;
  // The draft picked its model; cleared once the user changes it.
  modelGuessed?: boolean;
}

export interface TeamForm {
  lead: PersonForm;
  members: PersonForm[];
}

export interface DepartmentForm extends TeamForm {
  key: number;
  departmentId?: string;
  name: string;
  purpose: string;
  rules: string;
  // The default first; empty until the user chooses.
  workspaceIds: string[];
  autonomy: Autonomy;
}

// Keys only need to be unique on one screen.
let lastKey = 0;
export const nextKey = () => {
  lastKey += 1;
  return lastKey;
};

export const LEAD_COLOUR = agentColours[3]?.value ?? "#3A6EA5";
export const memberColour = (index: number) =>
  agentColours[(index + 4) % agentColours.length]?.value ?? LEAD_COLOUR;

export function blankPerson(settings: RoleSettings, role = "", purpose = ""): PersonForm {
  return { key: nextKey(), role, purpose, instructions: "", settings };
}

export function blankDepartment(settings: RoleSettings): DepartmentForm {
  return {
    key: nextKey(),
    name: "",
    purpose: "",
    rules: "",
    workspaceIds: [],
    autonomy: "full",
    lead: blankPerson(settings, "Lead", "Splits each task among the team"),
    members: [],
  };
}

const personOfDraft = (person: DraftPerson): PersonForm => ({
  key: nextKey(),
  role: person.role,
  purpose: person.purpose,
  instructions: person.instructions,
  settings: person.settings,
  ...(person.agentId === undefined ? {} : { agentId: person.agentId }),
  ...(person.modelGuessed ? { modelGuessed: true } : {}),
});

// A draft keeps the workspace and permissions already chosen for the department it replaces.
export function formOfDraft(draft: DepartmentDraft, kept?: DepartmentForm): DepartmentForm {
  return {
    key: kept?.key ?? nextKey(),
    ...(draft.departmentId === undefined ? {} : { departmentId: draft.departmentId }),
    name: draft.name,
    purpose: draft.purpose,
    rules: draft.rules,
    workspaceIds: kept?.workspaceIds ?? [],
    autonomy: kept?.autonomy ?? "full",
    lead: personOfDraft(draft.lead),
    members: draft.members.map(personOfDraft),
  };
}

const draftPersonOf = (person: PersonForm): DraftPerson => ({
  role: person.role.trim() || "Member",
  purpose: person.purpose.trim(),
  instructions: person.instructions,
  settings: person.settings,
  ...(person.agentId === undefined ? {} : { agentId: person.agentId }),
});

// What a refining draft starts from: what the user sees now, edits included.
export function draftOfForm(form: DepartmentForm): DepartmentDraft {
  return {
    ...(form.departmentId === undefined ? {} : { departmentId: form.departmentId }),
    name: form.name.trim() || "New department",
    purpose: form.purpose.trim(),
    rules: form.rules,
    lead: draftPersonOf(form.lead),
    members: form.members.map(draftPersonOf),
  };
}

const settingsOfAgent = ({ settings }: AgentRecord): RoleSettings => {
  const { instructions: _, autonomy: __, ...rest } = settings;
  return rest;
};

const personOfAgent = (agent: AgentRecord): PersonForm => ({
  key: nextKey(),
  role: agent.role ?? "Member",
  purpose: agent.purpose ?? "",
  instructions: agent.settings.instructions ?? "",
  settings: settingsOfAgent(agent),
  agentId: agent.id,
});

export function formOfDepartment(
  department: DepartmentRecord,
  agents: Record<string, AgentRecord>,
): DepartmentForm {
  const lead = agents[department.leadAgentId];
  return {
    key: nextKey(),
    departmentId: department.id,
    name: department.name,
    purpose: department.purpose ?? "",
    rules: department.rules ?? "",
    workspaceIds: department.workspaceIds,
    autonomy: department.autonomy,
    lead:
      lead === undefined
        ? blankPerson({ harness: "claude", environment: { kind: "native" } }, "Lead")
        : personOfAgent(lead),
    members: Object.values(agents)
      .filter((agent) => agent.departmentId === department.id && agent.id !== lead?.id)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(personOfAgent),
  };
}

// A role as proposed by a lead; a kept member shows its own notes, which it keeps either way.
export function personOfRole(
  role: TeamRole,
  agents: Record<string, AgentRecord>,
  defaults: RoleSettings,
): PersonForm {
  const agent = role.agentId === undefined ? undefined : agents[role.agentId];
  return {
    key: nextKey(),
    role: role.role,
    purpose: role.purpose,
    instructions: role.instructions ?? agent?.settings.instructions ?? "",
    settings: role.settings ?? (agent === undefined ? defaults : settingsOfAgent(agent)),
    ...(role.agentId === undefined ? {} : { agentId: role.agentId }),
    ...(role.profileId === undefined ? {} : { profileId: role.profileId }),
  };
}

export const rolesOf = (members: readonly PersonForm[]): TeamRole[] =>
  members.map((member) => ({
    role: member.role.trim(),
    purpose: member.purpose.trim(),
    instructions: member.instructions,
    settings: member.settings,
    ...(member.agentId === undefined ? {} : { agentId: member.agentId }),
    ...(member.profileId === undefined ? {} : { profileId: member.profileId }),
  }));

// The lead's AI goes in only for a department that exists; a new one makes its lead apart.
export function teamOf(form: DepartmentForm): Team {
  const { lead } = form;
  return {
    name: form.name.trim(),
    lead: {
      role: lead.role.trim() || "Lead",
      purpose: lead.purpose.trim(),
      instructions: lead.instructions,
      ...(form.departmentId === undefined ? {} : { settings: lead.settings }),
    },
    roles: rolesOf(form.members),
  };
}

// The first thing that stops this department from being created or saved.
export function missingIn(form: DepartmentForm): string | undefined {
  if (form.name.trim() === "") return "Give the department a name.";
  if (form.lead.role.trim() === "") return "Give the lead a role name.";
  if (form.members.some((member) => member.role.trim() === "")) {
    return "Give every member a role name.";
  }
  return undefined;
}
