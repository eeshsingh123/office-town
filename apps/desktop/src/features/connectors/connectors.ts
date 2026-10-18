import type {
  AgentRecord,
  CatalogEntry,
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
let catalog: Promise<{ entries: CatalogEntry[]; keysInFile: boolean }> | undefined;

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

// Signed out or not answering, while the user still has it on.
export const needsUser = ({ enabled, status }: ConnectorRecord) =>
  enabled && (status === "signed_out" || status === "failing");

export function useConnectorNeedsUser(): boolean {
  return useApp((state) => Object.values(state.connectors).some(needsUser));
}

// The core's rule, so the side panel shows what an agent gets: guests get none.
export function usableBy(connectors: ConnectorRecord[], agent: AgentRecord) {
  return connectors.filter(({ enabled, audience }) => {
    if (agent.guest === true || !enabled) return false;
    return (
      audience.everyone ||
      audience.agentIds.includes(agent.id) ||
      (agent.departmentId !== undefined && audience.departmentIds.includes(agent.departmentId))
    );
  });
}

export function connectorOfSlug(slug: string): ConnectorRecord | undefined {
  return Object.values(useApp.getState().connectors).find(({ setup }) => setup.slug === slug);
}

// The app's page opens in the browser; the core hears back from it.
export async function signIn(connectorId: string): Promise<void> {
  const url = await api.connectorSignIn(connectorId);
  window.open(url, "_blank", "noopener");
}
