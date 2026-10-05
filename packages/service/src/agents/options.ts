import type { AgentRecord, PermissionMode, SessionOptions } from "@office-town/contract";
import { levelOf } from "../autonomy/policy.ts";
import type { Store } from "../store/store.ts";
import { settingsOf } from "./agents.ts";

// The harness runs in its ask mode, so every request reaches the core's guardrail, unless the
// agent's level is Bypass now.
export function permissionModeOf(store: Store, agentId: string): PermissionMode {
  return levelOf(store, agentId) === "bypass" ? "bypass" : "ask";
}

// How an agent's session runs: its harness settings in the given folders, the first being where
// it works.
export function sessionOptionsFor(
  store: Store,
  agent: AgentRecord,
  folders: { workspacePath?: string | undefined; additionalPaths?: string[] | undefined },
): SessionOptions {
  const { instructions: _, autonomy: __, ...settings } = settingsOf(store, agent);
  const { workspacePath, additionalPaths = [] } = folders;
  return {
    ...settings,
    permissionMode: permissionModeOf(store, agent.id),
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(additionalPaths.length === 0 ? {} : { additionalPaths }),
  };
}

// A workspace's folders as session options: the first is where the agent works.
export function inFolders(folders: string[]) {
  const [workspacePath, ...additionalPaths] = folders;
  return { workspacePath, additionalPaths };
}
