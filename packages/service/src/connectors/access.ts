import type {
  AgentRecord,
  Audience,
  ConnectorPermission,
  ConnectorRecord,
  SessionOptions,
} from "@office-town/contract";
import { hasVendorApps } from "@office-town/harness";
import { chooseAccount, sessionAccountId } from "../accounts/accounts.ts";
import { appsBrief } from "../agents/briefs.ts";
import type { Apps } from "../registry/session-registry.ts";
import type { ConnectorTool, Store } from "../store/store.ts";

// Everyone, the agent's department, or the agent itself.
export function reaches({ everyone, departmentIds, agentIds }: Audience, agent: AgentRecord) {
  return (
    everyone ||
    agentIds.includes(agent.id) ||
    (agent.departmentId !== undefined && departmentIds.includes(agent.departmentId))
  );
}

// Guests get no connectors (D-67).
export function mayUse(connector: ConnectorRecord, agent: AgentRecord): boolean {
  return agent.guest !== true && connector.enabled && reaches(connector.audience, agent);
}

// Claude Code connects these itself, so only its agents reach them, never through the hub (D-68).
export const isClaudeApp = (connector: ConnectorRecord) => connector.setup.kind === "claude";

// The hub's connectors, which any harness reaches.
export function usableBy(store: Store, agentId: string): ConnectorRecord[] {
  const agent = store.getAgent(agentId);
  if (agent === undefined) return [];
  return store
    .listConnectors()
    .filter((connector) => !isClaudeApp(connector) && mayUse(connector, agent));
}

// The Claude apps of the login a session runs on that the agent may use and that are connected.
export function claudeAppsOn(store: Store, agent: AgentRecord, accountId: string) {
  return store
    .listConnectors()
    .filter(
      (connector) =>
        isClaudeApp(connector) &&
        connector.setup.account === accountId &&
        connector.status === "connected" &&
        mayUse(connector, agent),
    );
}

// Every app an agent reaches, by name, for a lead's roster; its Claude apps by the account it
// would run on now.
export function reachableApps(store: Store, agent: AgentRecord): string[] {
  const own = hasVendorApps(agent.settings.harness)
    ? claudeAppsOn(store, agent, chooseAccount(store, agent.settings).accountId)
    : [];
  return [...usableBy(store, agent.id), ...own].map(({ setup }) => setup.name);
}

// What a new conversation gets: the apps its agent may use now, and the lines naming them.
export function appsOf(store: Store) {
  return (agentId: string, options: SessionOptions): Apps => {
    const agent = store.getAgent(agentId);
    const usable = usableBy(store, agentId);
    const claude =
      agent === undefined || !hasVendorApps(options.harness)
        ? []
        : claudeAppsOn(store, agent, sessionAccountId(options));
    const brief = appsBrief(usable, claude);
    return {
      connectorIds: usable.map(({ id }) => id),
      vendorApps: claude.flatMap(({ setup }) => setup.app ?? []),
      ...(brief === undefined ? {} : { brief }),
    };
  };
}

// Unmarked counts as a change.
export const isRead = (tool: ConnectorTool) => tool.annotations?.readOnlyHint === true;

export type Decision = "go" | "ask" | "refuse";

// Reads never ask; the connector's own setting decides a change, whatever the department's level.
export function decide(permission: ConnectorPermission, read: boolean): Decision {
  if (read) return "go";
  if (permission === "read_only") return "refuse";
  return permission === "ask" ? "ask" : "go";
}
