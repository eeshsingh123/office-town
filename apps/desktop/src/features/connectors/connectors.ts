import type {
  AgentRecord,
  CatalogEntry,
  ConnectorCatalog,
  ConnectorCategory,
  ConnectorPermission,
  ConnectorRecord,
} from "@office-town/contract";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

export const PERMISSIONS: { value: ConnectorPermission; title: string; description: string }[] = [
  { value: "read_only", title: "Read only", description: "Never changes anything" },
  { value: "ask", title: "Ask me first", description: "Asks before it changes anything" },
  { value: "dont_ask", title: "Don't ask", description: "Goes ahead with everything" },
];

export const permissionTitle = (permission: ConnectorPermission) =>
  PERMISSIONS.find(({ value }) => value === permission)?.title ?? permission;

export const CATEGORIES: { value: ConnectorCategory; label: string }[] = [
  { value: "work", label: "Work and docs" },
  { value: "code", label: "Code" },
  { value: "messages", label: "Messages" },
  { value: "sales", label: "Sales" },
  { value: "design", label: "Design" },
];

export function useConnectors(): ConnectorRecord[] {
  const connectors = useApp((state) => state.connectors);
  return useMemo(
    () => Object.values(connectors).toSorted((a, b) => a.setup.name.localeCompare(b.setup.name)),
    [connectors],
  );
}

// Read once; it only changes with the app.
let catalog: Promise<ConnectorCatalog> | undefined;

export function useCatalog() {
  const [loaded, setLoaded] = useState<Awaited<NonNullable<typeof catalog>>>();
  useEffect(() => {
    catalog ??= api.connectorCatalog();
    catalog.then(setLoaded, () => {
      catalog = undefined;
    });
  }, []);
  return loaded;
}

// Where the user connects Claude apps; Claude Code loads them for the account's login (D-68).
export const CLAUDE_CONNECTORS = "https://claude.ai/customize/connectors";

export const isClaudeApp = ({ setup }: { setup: ConnectorRecord["setup"] }) =>
  setup.kind === "claude";

// A catalog tile matches a Claude app by name, as claude.ai names it.
export const sameApp = (entry: CatalogEntry, connector: ConnectorRecord) =>
  connector.setup.name.toLowerCase() === entry.setup.name.toLowerCase() ||
  connector.setup.name.toLowerCase() === entry.setup.maker?.toLowerCase();

// The Claude apps are read again; a page signed in to or connected on claude.ai shows once the
// user is back in the app.
export function refreshApps(): void {
  api.refreshConnectors().catch((failure: unknown) => console.error(failure));
}

export function refreshOnReturn(): void {
  window.addEventListener("focus", refreshApps, { once: true });
}

// Signed out or not answering, while the user still has it on. claude.ai lists apps such as Gmail
// before the user ever connects them, so a signed-out Claude app is an offer, not a problem.
export const needsUser = (connector: ConnectorRecord) =>
  connector.enabled &&
  (connector.status === "failing" ||
    (connector.status === "signed_out" && !isClaudeApp(connector)));

export function useConnectorNeedsUser(): boolean {
  return useApp((state) => Object.values(state.connectors).some(needsUser));
}

// The core's rule, so the side panel shows what an agent gets: guests get none, and Claude apps
// go to Claude agents only, by the account it is set to (Automatic shows each app once).
export function usableBy(connectors: ConnectorRecord[], agent: AgentRecord) {
  const seen = new Set<string>();
  return connectors.filter(({ enabled, audience, setup, status }) => {
    if (agent.guest === true || !enabled) return false;
    const reaches =
      audience.everyone ||
      audience.agentIds.includes(agent.id) ||
      (agent.departmentId !== undefined && audience.departmentIds.includes(agent.departmentId));
    if (!reaches || setup.kind !== "claude") return reaches;
    const { harness, accountId } = agent.settings;
    if (harness !== "claude" || status !== "connected" || seen.has(setup.name)) return false;
    if (accountId !== undefined && setup.account !== accountId) return false;
    seen.add(setup.name);
    return true;
  });
}

export function connectorOfSlug(slug: string): ConnectorRecord | undefined {
  return Object.values(useApp.getState().connectors).find(({ setup }) => setup.slug === slug);
}

// Claude's page for the app opens in the browser; the app shows as connected once the user is back.
export async function signIn(connectorId: string): Promise<void> {
  const url = await api.connectorSignIn(connectorId);
  window.open(url, "_blank", "noopener");
  refreshOnReturn();
}

export function openClaudeConnectors(): void {
  window.open(CLAUDE_CONNECTORS, "_blank", "noopener");
  refreshOnReturn();
}
