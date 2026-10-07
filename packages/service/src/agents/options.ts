import type { AgentRecord, PermissionMode, SessionOptions } from "@office-town/contract";
import { levelOf } from "../autonomy/policy.ts";
import type { Store } from "../store/store.ts";
import { settingsOf } from "./agents.ts";

// The harness runs in its ask mode, so every request reaches the core's guardrail, unless the
// agent's level is Bypass now.
export function permissionModeOf(store: Store, agentId: string): PermissionMode {
  return levelOf(store, agentId) === "bypass" ? "bypass" : "ask";
}

export interface SessionFolders {
  workspacePath?: string | undefined;
  additionalPaths?: string[] | undefined;
  // Folders the agent may read but never change, such as an upstream department's workspace.
  readOnlyPaths?: string[] | undefined;
}

// How an agent's session runs: its harness settings in the given folders, the first being where
// it works. A read-only folder is opened like the others, and the policy keeps it unchanged.
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

// A workspace's folders as session options: the first is where the agent works.
export function inFolders(folders: string[]) {
  const [workspacePath, ...additionalPaths] = folders;
  return { workspacePath, additionalPaths };
}
