import type {
  AgentRecord,
  Audience,
  ConnectorPermission,
  ConnectorRecord,
} from "@office-town/contract";
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

export function usableBy(store: Store, agentId: string): ConnectorRecord[] {
  const agent = store.getAgent(agentId);
  if (agent === undefined) return [];
  return store.listConnectors().filter((connector) => mayUse(connector, agent));
}

// What a new conversation gets: the connectors its agent may use now, and the lines naming them.
export function appsOf(store: Store) {
  return (agentId: string): Apps => {
    const usable = usableBy(store, agentId);
    const brief = appsBrief(usable);
    return { connectorIds: usable.map(({ id }) => id), ...(brief === undefined ? {} : { brief }) };
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
