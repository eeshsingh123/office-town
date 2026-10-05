import type {
  AgentRecord,
  DepartmentRecord,
  SessionOptions,
  Team,
  TeamRole,
} from "@office-town/contract";
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

// The workspace's folders, which must all still exist; the first is where the team works.
export function workspaceFolders(store: Store, workspaceId: string): string[] {
  const { folders } = store.useWorkspace(workspaceId);
  requireFolders(folders);
  return folders;
}

export interface TeamChange {
  added: AgentRecord[];
  removed: AgentRecord[];
}

function addMember(store: Store, departmentId: string, role: TeamRole): AgentRecord {
  const profile = role.profileId === undefined ? undefined : store.getProfile(role.profileId);
  if (role.profileId !== undefined && profile === undefined) {
    throw new RecordNotFoundError("profile", role.profileId);
  }
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

// Makes the department's workers match the team: kept members take their new role and settings,
// new roles become new agents, and members left out leave the department.
export function applyTeam(store: Store, department: DepartmentRecord, team: Team): TeamChange {
  const members = store
    .listMembers(department.id)
    .filter((member) => member.id !== department.leadAgentId);
  const kept = new Set(team.roles.flatMap((role) => role.agentId ?? []));
  for (const id of kept) {
    if (!members.some((member) => member.id === id)) {
      throw new TeamError("A kept role names an agent that is not in this department.");
    }
  }
  const added: AgentRecord[] = [];
  for (const role of team.roles) {
    if (role.agentId === undefined) {
      added.push(addMember(store, department.id, role));
      continue;
    }
    const member = members.find((known) => known.id === role.agentId);
    if (member === undefined) continue;
    const linked = role.settings === undefined ? (role.profileId ?? member.profileId) : undefined;
    store.updateAgent(member.id, {
      role: role.role,
      purpose: role.purpose,
      departmentId: department.id,
      settings: role.settings === undefined ? member.settings : role.settings,
      ...(linked === undefined ? {} : { profileId: linked }),
    });
  }
  const removed = members.filter((member) => !kept.has(member.id));
  for (const member of removed) {
    const { departmentId: _, ...rest } = member;
    store.updateAgent(member.id, rest);
  }
  return { added, removed };
}

// One line per worker, as the lead reads its team.
export function rosterOf(store: Store, department: DepartmentRecord): string {
  const workers = store
    .listMembers(department.id)
    .filter((member) => member.id !== department.leadAgentId);
  if (workers.length === 0) return "You have no workers yet.";
  return workers
    .map((member) => {
      const { harness, model } = settingsOf(store, member);
      const what = member.purpose ? `: ${member.purpose}` : "";
      return `- ${member.name}, ${member.role ?? "worker"}${what} (${harness}${model ? `, ${model}` : ""})`;
    })
    .join("\n");
}
