import type { AgentRecord, PermissionMode, SessionOptions } from "@office-town/contract";
import { levelOf } from "../autonomy/policy.ts";
import type { Store } from "../store/store.ts";
import { settingsOf } from "./agents.ts";

// Ask mode, so every request reaches the core's guardrail, unless the level is Bypass now.
export function permissionModeOf(store: Store, agentId: string): PermissionMode {
  return levelOf(store, agentId) === "bypass" ? "bypass" : "ask";
}

export interface SessionFolders {
  workspacePath?: string | undefined;
  additionalPaths?: string[] | undefined;
  readOnlyPaths?: string[] | undefined;
}

// A read-only folder is opened like the others; the policy keeps it unchanged.
export function sessionOptionsFor(
  store: Store,
  agent: AgentRecord,
  folders: SessionFolders,
): SessionOptions {
  const { instructions: _, autonomy: __, ...settings } = settingsOf(store, agent);
  const { workspacePath, readOnlyPaths = [] } = folders;
  const additionalPaths = [
    ...new Set([...(folders.additionalPaths ?? []), ...readOnlyPaths]),
  ].filter((path) => path !== workspacePath);
  return {
    ...settings,
    permissionMode: permissionModeOf(store, agent.id),
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(additionalPaths.length === 0 ? {} : { additionalPaths }),
    ...(readOnlyPaths.length === 0 ? {} : { readOnlyPaths }),
  };
}

// The first is where the agent works.
export function inFolders(folders: string[]) {
  const [workspacePath, ...additionalPaths] = folders;
  return { workspacePath, additionalPaths };
}
