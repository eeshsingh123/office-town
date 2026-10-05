import { isAbsolute, relative, resolve } from "node:path";
import {
  type Autonomy,
  lowerAutonomy,
  type SessionEvent,
  type SessionRecord,
} from "@office-town/contract";
import { settingsOf } from "../agents/agents.ts";
import type { Store } from "../store/store.ts";

type PermissionRequest = Extract<SessionEvent, { type: "permission.requested" }>["payload"];

// Reading and changing files, which Trusted lets through inside the workspace.
const FILE_WORK = new Set(["read", "search", "edit", "delete", "move", "think"]);
const CHANGES = new Set(["edit", "delete", "move"]);
// Git's and the harnesses' own settings, hooks and MCP servers: changing them can make a command
// run later without asking, so Trusted asks for it.
const RUNS_COMMANDS = new Set([
  ".git",
  ".claude",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  ".mcp.json",
]);

function inside(folder: string, path: string): boolean {
  const way = relative(folder, path);
  return way === "" || (!way.startsWith("..") && !isAbsolute(way));
}

// Whether the level lets a request through without the user. Trusted allows reading and editing
// inside the workspace's folders and asks for everything else: commands, web access, anything
// outside, changes to what runs commands, and anything whose action it cannot read. Full and
// Bypass allow all; Supervised none.
export function allows(level: Autonomy, request: PermissionRequest, folders: string[]): boolean {
  if (level === "full" || level === "bypass") return true;
  if (level === "supervised") return false;
  const { kind, locations = [] } = request;
  if (kind === undefined || !FILE_WORK.has(kind) || locations.length === 0) return false;
  const [workspace] = folders;
  if (workspace === undefined) return false;
  return locations.every((location) => {
    const path = resolve(workspace, location);
    const folder = folders.find((candidate) => inside(candidate, path));
    if (folder === undefined) return false;
    const parts = relative(folder, path).toLowerCase().split(/[\\/]/);
    return !CHANGES.has(kind) || !parts.some((part) => RUNS_COMMANDS.has(part));
  });
}

// The level an agent works at now: its department's, or its own without one, lowered by its
// profile or settings. A change applies to the next request.
export function levelOf(store: Store, agentId: string): Autonomy {
  const agent = store.getAgent(agentId);
  if (agent === undefined) return "supervised";
  const department =
    agent.departmentId === undefined ? undefined : store.getDepartment(agent.departmentId);
  const level = department?.autonomy ?? agent.autonomy ?? "supervised";
  return lowerAutonomy(level, settingsOf(store, agent).autonomy);
}

type Guard = (session: SessionRecord, request: PermissionRequest) => Autonomy | undefined;

// The core's one guardrail, the same for every harness: the level answers what it allows, and the
// rest waits for the user in Needs you.
export function autonomyGuard(store: Store): Guard {
  return (session, request) => {
    const level = levelOf(store, session.agentId);
    const { workspacePath, additionalPaths = [] } = session.options;
    const folders =
      workspacePath === undefined ? additionalPaths : [workspacePath, ...additionalPaths];
    return allows(level, request, folders) ? level : undefined;
  };
}
