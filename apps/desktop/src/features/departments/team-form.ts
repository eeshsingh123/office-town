import {
  type AgentRecord,
  type Autonomy,
  agentColours,
  type DepartmentDraft,
  type DepartmentRecord,
  type DepartmentSettings,
  type DraftPerson,
  type RoleSettings,
  type Team,
  type TeamRole,
} from "@office-town/contract";
import { fits, SETTINGS_SHAPE } from "../../store/drafts.ts";

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

// Unique on one screen, where a kept draft can bring back keys from an earlier launch.
let lastKey = Date.now();
export const nextKey = () => {
  lastKey += 1;
  return lastKey;
};

export const LEAD_COLOUR = agentColours[3]?.value ?? "#3A6EA5";
export const memberColour = (index: number) =>
  agentColours[(index + 4) % agentColours.length]?.value ?? LEAD_COLOUR;

export function settingsOf(department: DepartmentRecord): DepartmentSettings {
  const {
    id: _,
    createdAt: _at,
    workspaceId: _default,
    leadAgentId: _lead,
    ...settings
  } = department;
  return settings;
}

// "Developer 2" works in the same role as "Developer"; older drafts numbered people that way.
export const baseRole = (role: string) => role.trim().replace(/\s*#?\d+$/, "") || role.trim();

// Which one of its role a numbered person is ("Developer 2" is 2).
export function roleNumber(role: string): number | undefined {
  const digits = /\s*#?(\d+)$/.exec(role.trim())?.[1];
  return digits === undefined ? undefined : Number(digits);
}

// People sharing a role, in the order each role first appears.
export function byRole<T>(
  people: readonly T[],
  roleOf: (person: T) => string | undefined,
): { role: string; people: T[] }[] {
  const groups = new Map<string, { role: string; people: T[] }>();
  for (const person of people) {
    const role = baseRole(roleOf(person) ?? "");
    const group = groups.get(role.toLowerCase()) ?? { role, people: [] };
    group.people.push(person);
    groups.set(role.toLowerCase(), group);
  }
  return [...groups.values()];
}

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

const PERSON_SHAPE = {
  key: 0,
  role: "",
  purpose: "",
  instructions: "",
  settings: SETTINGS_SHAPE,
};
const TEAM_SHAPE = { lead: PERSON_SHAPE, members: [PERSON_SHAPE] };
const DEPARTMENT_SHAPE = {
  ...TEAM_SHAPE,
  key: 0,
  name: "",
  purpose: "",
  rules: "",
  workspaceIds: [],
  autonomy: "",
};

// Bypass turns every guard off, so a kept draft never brings it back without its warning.
export const keptLevel = (level: Autonomy): Autonomy => (level === "bypass" ? "supervised" : level);

export const keptTeam = (saved: unknown) =>
  fits(saved, TEAM_SHAPE) ? (saved as TeamForm) : undefined;

export const keptDepartments = (saved: unknown) =>
  fits(saved, [DEPARTMENT_SHAPE])
    ? (saved as DepartmentForm[]).map((one) => ({ ...one, autonomy: keptLevel(one.autonomy) }))
    : undefined;

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

export const rosterOf = ({ members }: TeamForm) => members.flatMap((one) => one.agentId ?? []);

// Unsaved edits, caught up with the team as it is now: saving replaces the whole team, so someone
// who joined since `roster` was taken must stay, and someone who left must not come back.
export function teamSince(
  saved: unknown,
  roster: unknown,
  now: DepartmentForm,
): DepartmentForm | undefined {
  if (!fits(saved, DEPARTMENT_SHAPE) || !fits(roster, [""])) return undefined;
  const draft = saved as DepartmentForm;
  const known = roster as string[];
  const current = rosterOf(now);
  return {
    ...draft,
    autonomy: draft.autonomy === "bypass" ? now.autonomy : draft.autonomy,
    lead: draft.lead.agentId === now.lead.agentId ? draft.lead : now.lead,
    members: [
      ...draft.members.filter((one) => one.agentId === undefined || current.includes(one.agentId)),
      ...now.members.filter((one) => one.agentId !== undefined && !known.includes(one.agentId)),
    ],
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
