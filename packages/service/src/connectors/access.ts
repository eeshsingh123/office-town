import {
  type AgentRecord,
  type Audience,
  appKeyOf,
  type ConnectorAction,
  type ConnectorPermission,
  type ConnectorRecord,
  providerOf,
  type SessionOptions,
  type TaskRecord,
} from "@office-town/contract";
import { hasVendorApps, listHarnesses } from "@office-town/harness";
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

export const providerName = (harness: string) =>
  listHarnesses().find((known) => known.harness === harness)?.name ?? harness;

// A provider connects these itself, so only its agents reach them, never through the hub (D-68).
export const isProviderApp = (connector: ConnectorRecord) =>
  providerOf(connector.setup.kind) !== undefined;

// The hub's connectors, which any harness reaches.
export function usableBy(store: Store, agentId: string): ConnectorRecord[] {
  const agent = store.getAgent(agentId);
  if (agent === undefined) return [];
  return store
    .listConnectors()
    .filter((connector) => !isProviderApp(connector) && mayUse(connector, agent));
}

const appsOnLogin = (store: Store, harness: string, accountId: string) =>
  store
    .listConnectors()
    .filter(({ setup }) => providerOf(setup.kind) === harness && setup.account === accountId);

// The provider apps of the login a session runs on that the agent may use and that are connected.
export function providerAppsOn(
  store: Store,
  agent: AgentRecord,
  harness: string,
  accountId: string,
) {
  return appsOnLogin(store, harness, accountId).filter(
    (connector) => connector.status === "connected" && mayUse(connector, agent),
  );
}

// Every app an agent reaches, by name, for a lead's roster; its provider apps by the account it
// would run on now.
export function reachableApps(store: Store, agent: AgentRecord): string[] {
  const { harness } = agent.settings;
  const own = hasVendorApps(harness)
    ? providerAppsOn(store, agent, harness, chooseAccount(store, agent.settings).accountId)
    : [];
  return [...usableBy(store, agent.id), ...own].map(({ setup }) => setup.name);
}

// What a new conversation gets: the apps its agent may use now, and the lines naming them. Where
// the login has provider apps, the allowed ones are named even when none is, so the rest stay off.
export function appsOf(store: Store) {
  return (agentId: string, options: SessionOptions): Apps => {
    const agent = store.getAgent(agentId);
    const usable = usableBy(store, agentId);
    const accountId = sessionAccountId(options);
    const listed =
      agent !== undefined &&
      hasVendorApps(options.harness) &&
      appsOnLogin(store, options.harness, accountId).length > 0;
    const own = listed ? providerAppsOn(store, agent, options.harness, accountId) : [];
    const brief = appsBrief(usable, own);
    return {
      connectorIds: usable.map(({ id }) => id),
      ...(listed ? { vendorApps: own.flatMap(({ setup }) => setup.app ?? []) } : {}),
      ...(brief === undefined ? {} : { brief }),
    };
  };
}

// Unmarked counts as a change.
export const isRead = (tool: ConnectorTool) => tool.annotations?.readOnlyHint === true;

// A tool with a blank name cannot be called, so it is not one of the app's actions.
export const actionsOf = (tools: ConnectorTool[]): ConnectorAction[] =>
  tools
    .filter((tool) => tool.name.trim() !== "")
    .map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      readOnly: isRead(tool),
    }));

export type Decision = "go" | "ask" | "refuse";

// Reads never ask; the connector's own setting decides a change, whatever the department's level.
export function decide(permission: ConnectorPermission, read: boolean): Decision {
  if (read) return "go";
  if (permission === "read_only") return "refuse";
  return permission === "ask" ? "ask" : "go";
}

// The automation whose run or check a session works in, also for a part of a chief's goal that is
// one, read now so an edit or a removal applies at the next call.
function automationOf(store: Store, sessionId: string) {
  const session = store.getSession(sessionId);
  const task = session === undefined ? undefined : store.getTask(session.taskId);
  const ofAutomation = (origin: TaskRecord["origin"]) =>
    origin?.kind === "automation" || origin?.kind === "check" ? origin.automationId : undefined;
  const parent = task?.parentTaskId === undefined ? undefined : store.getTask(task.parentTaskId);
  const id = ofAutomation(task?.origin) ?? ofAutomation(parent?.origin);
  return id === undefined ? undefined : store.automations.get(id);
}

// An Ask me first change goes ahead where the automation it works for lets that app act without
// asking; the app's Read only and who may use it still decide first (D-129).
export function automationAllows(
  store: Store,
  sessionId: string,
  connector: ConnectorRecord,
): boolean {
  const allowed = automationOf(store, sessionId)?.rules.appsWithoutAsking ?? [];
  return allowed.includes(appKeyOf(connector.setup.name));
}
