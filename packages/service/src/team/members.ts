import type { AgentRecord, DepartmentRecord, Team, TeamRole } from "@office-town/contract";
import { freeIdentity, settingsOf } from "../agents/agents.ts";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { requireFolders } from "../task-folders.ts";
import type { ReadCatalog } from "./catalogs.ts";

export interface TeamContext {
  store: Store;
  registry: SessionRegistry;
  readCatalog: ReadCatalog;
  // Where workers' worktrees live, apart from the user's folders.
  dataFolder: string;
}

export class DepartmentBusyError extends Error {
  constructor(name: string) {
    super(`${name} is already working on a goal. Stop it, or wait for it to finish.`);
    this.name = "DepartmentBusyError";
  }
}

export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamError";
  }
}

// All must still exist; the first is where the team works.
export function workspaceFolders(store: Store, workspaceId: string): string[] {
  const { folders } = store.useWorkspace(workspaceId);
  requireFolders(folders);
  return folders;
}

export interface TeamChange {
  added: AgentRecord[];
  removed: AgentRecord[];
  // Kept members whose role, purpose or settings changed.
  updated: AgentRecord[];
}

// The same settings in any key order give the same text.
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

// Team rows carry harness settings only, so a kept member keeps its instructions and lowered level.
function ownOf({ settings: { instructions, autonomy } }: AgentRecord) {
  return {
    ...(instructions === undefined ? {} : { instructions }),
    ...(autonomy === undefined ? {} : { autonomy }),
  };
}

function workersOf(store: Store, department: DepartmentRecord): AgentRecord[] {
  return store.listMembers(department.id).filter((member) => member.id !== department.leadAgentId);
}

// Checked before anything is written, so a team that cannot be applied changes nothing.
export function checkTeam(
  store: Store,
  department: DepartmentRecord | undefined,
  team: Team,
): void {
  const workers = department === undefined ? [] : workersOf(store, department);
  for (const role of team.roles) {
    if (role.profileId !== undefined && store.getProfile(role.profileId) === undefined) {
      throw new RecordNotFoundError("profile", role.profileId);
    }
    if (role.agentId !== undefined && !workers.some((worker) => worker.id === role.agentId)) {
      throw new TeamError("A kept role names an agent that is not in this department.");
    }
    if (role.agentId === undefined && role.settings === undefined && role.profileId === undefined) {
      throw new TeamError(`The role "${role.role}" has no settings.`);
    }
  }
}

function addMember(store: Store, departmentId: string, role: TeamRole): AgentRecord {
  const profile = role.profileId === undefined ? undefined : store.getProfile(role.profileId);
  const identity = freeIdentity(store);
  const settings = role.settings ?? profile?.settings;
  if (settings === undefined) throw new TeamError(`The role "${role.role}" has no settings.`);
  return store.createAgent({
    name: identity.name,
    colour: profile?.colour ?? identity.colour,
    role: role.role,
    purpose: role.purpose,
    departmentId,
    ...(profile === undefined ? {} : { profileId: profile.id }),
    settings,
  });
}

// Call checkTeam first.
export function applyTeam(store: Store, department: DepartmentRecord, team: Team): TeamChange {
  const members = workersOf(store, department);
  const kept = new Set(team.roles.flatMap((role) => role.agentId ?? []));
  const added: AgentRecord[] = [];
  const updated: AgentRecord[] = [];
  for (const role of team.roles) {
    if (role.agentId === undefined) {
      added.push(addMember(store, department.id, role));
      continue;
    }
    const member = members.find((known) => known.id === role.agentId);
    if (member === undefined) continue;
    const linked = role.settings === undefined ? (role.profileId ?? member.profileId) : undefined;
    const after = store.updateAgent(member.id, {
      role: role.role,
      purpose: role.purpose,
      departmentId: department.id,
      settings:
        role.settings === undefined ? member.settings : { ...ownOf(member), ...role.settings },
      ...(linked === undefined ? {} : { profileId: linked }),
    });
    const same =
      after.role === member.role &&
      after.purpose === member.purpose &&
      after.profileId === member.profileId &&
      canonical(after.settings) === canonical(member.settings);
    if (!same) updated.push(after);
  }
  const removed = members.filter((member) => !kept.has(member.id));
  for (const member of removed) {
    const { departmentId: _, ...rest } = member;
    store.updateAgent(member.id, rest);
  }
  return { added, removed, updated };
}

export function rosterOf(store: Store, department: DepartmentRecord): string {
  const workers = workersOf(store, department);
  if (workers.length === 0) return "You have no workers yet.";
  return workers
    .map((member) => {
      const { harness, model } = settingsOf(store, member);
      const what = member.purpose ? `: ${member.purpose}` : "";
      return `- ${member.name}, ${member.role ?? "worker"}${what} (${harness}${model ? `, ${model}` : ""})`;
    })
    .join("\n");
}
