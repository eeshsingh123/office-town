import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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

// The only kinds let through inside a read-only folder.
const READS = new Set(["read", "search", "think"]);

function inside(folder: string, path: string): boolean {
  const way = relative(folder, path);
  return way === "" || (!way.startsWith("..") && !isAbsolute(way));
}

const WSL_LOCALHOST = /^\\\\wsl\.localhost\\/i;

// One form for one place: links and junctions resolved through the nearest part that exists,
// WSL's two share names made one, and case ignored where Windows ignores it.
function canonicalPath(path: string): string {
  const missing: string[] = [];
  let existing = resolve(path);
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  const real = join(existsSync(existing) ? realpathSync.native(existing) : existing, ...missing);
  const shared = real.replace(WSL_LOCALHOST, "\\\\wsl$\\");
  return process.platform === "win32" ? shared.toLowerCase() : shared;
}

// A location inside a read-only folder may only be read, whatever the level. A read-only folder
// that holds one of the agent's own folders is left out, or every edit of its own would ask.
function touchesReadOnly(request: PermissionRequest, folders: string[], readOnly: string[]) {
  const { kind, locations = [] } = request;
  if (readOnly.length === 0 || locations.length === 0) return false;
  const guarded = new Set(readOnly.map(canonicalPath));
  const own = folders.map(canonicalPath).filter((folder) => !guarded.has(folder));
  const kept = [...guarded].filter((folder) => !own.some((each) => inside(folder, each)));
  const base = folders[0] ?? "";
  const touched = locations.some((location) => {
    const path = canonicalPath(resolve(base, location));
    return kept.some((folder) => inside(folder, path));
  });
  return touched && (kind === undefined || !READS.has(kind));
}

// Whether the level lets a request through without the user. Anything but a read inside a
// read-only folder never goes through. Trusted allows reading and editing inside the workspace's
// folders and asks for everything else: commands, web access, anything outside, changes to what
// runs commands, and anything whose action it cannot read. Full and Bypass allow all; Supervised
// none.
export function allows(
  level: Autonomy,
  request: PermissionRequest,
  folders: string[],
  readOnly: string[] = [],
): boolean {
  if (touchesReadOnly(request, folders, readOnly)) return false;
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
    const { workspacePath, additionalPaths = [], readOnlyPaths = [] } = session.options;
    const folders =
      workspacePath === undefined ? additionalPaths : [workspacePath, ...additionalPaths];
    return allows(level, request, folders, readOnlyPaths) ? level : undefined;
  };
}
