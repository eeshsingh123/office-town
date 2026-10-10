import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type Autonomy,
  lowerAutonomy,
  type SessionEvent,
  type SessionRecord,
} from "@office-town/contract";
import type { Store } from "../store/store.ts";

type PermissionRequest = Extract<SessionEvent, { type: "permission.requested" }>["payload"];

// What Trusted lets through inside the workspace.
const FILE_WORK = new Set(["read", "search", "edit", "delete", "move", "think"]);
const CHANGES = new Set(["edit", "delete", "move"]);
// Changing these can make a command run later without asking, so Trusted asks.
const RUNS_COMMANDS = new Set([
  ".git",
  ".claude",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  ".mcp.json",
]);

const READS = new Set(["read", "search", "think"]);

function inside(folder: string, path: string): boolean {
  const way = relative(folder, path);
  return way === "" || (!way.startsWith("..") && !isAbsolute(way));
}

const WSL_LOCALHOST = /^\\\\wsl\.localhost\\/i;

// Links resolved, WSL's two share names made one, case ignored where Windows ignores it.
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

// A read-only folder holding the agent's own folder is left out, or its every edit would ask.
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

// Only reads go through inside a read-only folder, at any level. Trusted asks for anything it cannot read.
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

// The department's level, or the agent's own without one, lowered by its profile or settings.
export function levelOf(store: Store, agentId: string): Autonomy {
  const agent = store.getAgent(agentId);
  if (agent === undefined) return "supervised";
  const department =
    agent.departmentId === undefined ? undefined : store.getDepartment(agent.departmentId);
  const level = department?.autonomy ?? agent.autonomy ?? "supervised";
  return lowerAutonomy(level, agent.settings.autonomy);
}

type Guard = (session: SessionRecord, request: PermissionRequest) => Autonomy | undefined;

export function autonomyGuard(store: Store): Guard {
  return (session, request) => {
    const level = levelOf(store, session.agentId);
    const { workspacePath, additionalPaths = [], readOnlyPaths = [] } = session.options;
    const folders =
      workspacePath === undefined ? additionalPaths : [workspacePath, ...additionalPaths];
    return allows(level, request, folders, readOnlyPaths) ? level : undefined;
  };
}
