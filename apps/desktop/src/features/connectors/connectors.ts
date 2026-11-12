import {
  type AgentRecord,
  type AppAudience,
  appKeyOf,
  type CatalogEntry,
  type ConnectorCatalog,
  type ConnectorCategory,
  type ConnectorPermission,
  type ConnectorRecord,
  providerOf,
} from "@office-town/contract";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

export const PERMISSIONS: { value: ConnectorPermission; title: string; description: string }[] = [
  { value: "read_only", title: "Read only", description: "Never changes anything" },
  { value: "ask", title: "Ask me first", description: "Asks before it changes anything" },
  { value: "dont_ask", title: "Don't ask", description: "Never asks first" },
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

// Signed in to by a provider and used by its agents only (D-68, D-96).
export const isProviderApp = ({ setup }: { setup: ConnectorRecord["setup"] }) =>
  providerOf(setup.kind) !== undefined;

// A catalog tile matches a provider app by name, as the provider names it.
export const sameApp = (entry: CatalogEntry, connector: ConnectorRecord) =>
  entry.setup.slug === connector.setup.slug ||
  appKeyOf(connector.setup.name) === appKeyOf(entry.setup.name) ||
  appKeyOf(connector.setup.name) === appKeyOf(entry.setup.maker ?? "");

// A provider app it lists but that was never signed in, such as claude.ai's Gmail before its first
// sign-in: an offer, not a problem.
export const isOffer = (connector: ConnectorRecord) =>
  isProviderApp(connector) && connector.status === "signed_out" && connector.actions === 0;

// The only alert the page shows (D-96): a sign-in that worked before and has to be renewed.
export const needsRenewing = (connector: ConnectorRecord) =>
  connector.enabled && connector.status === "signed_out" && !isOffer(connector);

// One app, however many ways it is reached: shared first, since agents use it first there.
export interface AppGroup {
  key: string;
  name: string;
  // Its logo's slug, and its catalog entry when listed.
  logo: string;
  entry?: CatalogEntry;
  routes: ConnectorRecord[];
}

const sharedFirst = (a: ConnectorRecord, b: ConnectorRecord) =>
  Number(isProviderApp(a)) - Number(isProviderApp(b));

const logoSlug = (connector: ConnectorRecord) =>
  isProviderApp(connector)
    ? connector.setup.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")
    : connector.setup.slug;

export function groupApps(connectors: ConnectorRecord[], entries: CatalogEntry[] = []): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const connector of connectors) {
    const entry = entries.find((candidate) => sameApp(candidate, connector));
    const key = entry?.setup.slug ?? appKeyOf(connector.setup.name);
    const group = groups.get(key);
    if (group !== undefined) {
      group.routes.push(connector);
      continue;
    }
    groups.set(key, {
      key,
      name: entry?.setup.name ?? connector.setup.name,
      logo: entry?.setup.slug ?? logoSlug(connector),
      ...(entry === undefined ? {} : { entry }),
      routes: [connector],
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    routes: group.routes.toSorted(sharedFirst),
  }));
}

// The tags a vetted entry would get: its own way in, then each provider that signs in to it.
export function entryTags(entry: CatalogEntry): string[] {
  const own = providerOf(entry.setup.kind) ?? "all";
  return [...new Set([own, ...entry.signIn])].toSorted(
    (a, b) => Number(a !== "all") - Number(b !== "all"),
  );
}

// Who can use it, as provider tags: "all" for a shared app, else each provider once.
export function tagsOf(routes: { setup: ConnectorRecord["setup"] }[]): string[] {
  const tags = routes.map(({ setup }) => providerOf(setup.kind) ?? "all");
  return [...new Set(tags)].toSorted((a, b) => Number(a !== "all") - Number(b !== "all"));
}

// The provider apps are read again; an app signed in to in the browser shows once the user is
// back in the app.
export function refreshApps(): void {
  api.refreshConnectors().catch((failure: unknown) => console.error(failure));
}

export function refreshOnReturn(): void {
  window.addEventListener("focus", refreshApps, { once: true });
}

export function useConnectorNeedsUser(): boolean {
  return useApp((state) => Object.values(state.connectors).some(needsRenewing));
}

// The core's rule, so the side panel shows what an agent gets: guests get none, and a provider's
// apps go to its agents only, by the account it is set to (Automatic shows each app once).
export function usableBy(connectors: ConnectorRecord[], agent: AgentRecord) {
  const seen = new Set<string>();
  return connectors.filter(({ enabled, audience, setup, status }) => {
    if (agent.guest === true || !enabled) return false;
    const reaches =
      audience.everyone ||
      audience.agentIds.includes(agent.id) ||
      (agent.departmentId !== undefined && audience.departmentIds.includes(agent.departmentId));
    const provider = providerOf(setup.kind);
    if (!reaches || provider === undefined) return reaches;
    const { harness, accountId } = agent.settings;
    if (harness !== provider || status !== "connected" || seen.has(setup.name)) return false;
    if (accountId !== undefined && setup.account !== accountId) return false;
    seen.add(setup.name);
    return true;
  });
}

export function connectorOfSlug(slug: string): ConnectorRecord | undefined {
  return Object.values(useApp.getState().connectors).find(({ setup }) => setup.slug === slug);
}

// The provider's page for the app opens in the browser; it shows as connected once the user is back.
export async function signIn(connectorId: string): Promise<void> {
  const url = await api.connectorSignIn(connectorId);
  window.open(url, "_blank", "noopener");
  refreshOnReturn();
}

export function openClaudeConnectors(): void {
  window.open(CLAUDE_CONNECTORS, "_blank", "noopener");
  refreshOnReturn();
}

// The provider's own page where the user adds the app: claude.ai's connectors, or the page Codex
// gives for it. The provider keeps the sign-in; the app shows once the user is back (D-96).
export async function setUpThrough(
  provider: string,
  app: string,
  ask?: { requestId: string; audience: AppAudience },
): Promise<void> {
  const url = await api.providerSetup({ provider, app, ...(ask === undefined ? {} : { ask }) });
  window.open(url, "_blank", "noopener");
  refreshOnReturn();
}
