import {
  type AgentSettings,
  type AppAudience,
  appKeyOf,
  type CatalogEntry,
  type ConnectorCatalog,
  type ConnectorCategory,
  type ConnectorPermission,
  type ConnectorRecord,
  isEntryApp,
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

// Signed in to by a provider and used by its agents only (D-68, D-96).
export const isProviderApp = ({ setup }: { setup: ConnectorRecord["setup"] }) =>
  providerOf(setup.kind) !== undefined;

// A provider app it lists but that was never signed in, such as claude.ai's Gmail before its first
// sign-in: an offer, not a problem.
export const isOffer = (connector: ConnectorRecord) =>
  isProviderApp(connector) && connector.status === "signed_out" && connector.actions === 0;

// A sign-in that worked before and has to be renewed.
export const needsRenewing = (connector: ConnectorRecord) =>
  connector.enabled && connector.status === "signed_out" && !isOffer(connector);

const notAnswering = (connector: ConnectorRecord) =>
  connector.enabled && connector.status === "failing";

// One status per app, the worst of its routes: what needs the user first.
export type AppState = "renew" | "failing" | "off" | "ready" | "offer";

export function stateOf(routes: ConnectorRecord[]): AppState {
  if (routes.every(isOffer)) return "offer";
  if (routes.some(needsRenewing)) return "renew";
  if (routes.some(notAnswering)) return "failing";
  if (routes.every(({ enabled }) => !enabled)) return "off";
  return "ready";
}

export const needsUser = (routes: ConnectorRecord[]) => {
  const state = stateOf(routes);
  return state === "renew" || state === "failing";
};

// Codex's own tools rather than apps the user connected: servers from the user's Codex settings
// ("server:<name>") and OpenAI's built-in apps.
export const isCodexOwn = ({ setup }: ConnectorRecord) =>
  setup.kind === "codex" &&
  (setup.app?.startsWith("server:") === true ||
    setup.app?.startsWith("connector_openai_") === true);

const KNOWN_NAMES: Record<string, string> = {
  codex_app: "Codex app",
  cua_repl: "Computer use",
  node_repl: "Node runner",
};

// A raw server id such as "cua_repl" reads as words; a name with capitals is kept as written.
export function displayName(name: string): string {
  const known = KNOWN_NAMES[name];
  if (known !== undefined) return known;
  if (!name.includes("_") && name !== name.toLowerCase()) return name;
  const words = name.replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Where an app not on the vetted list comes from, as the one line under its name.
export function sourceLine(route: ConnectorRecord): string {
  const { setup } = route;
  if (isOffer(route)) return "Not set up";
  if (isCodexOwn(route)) {
    return setup.app?.startsWith("server:") === true
      ? "From your Codex settings"
      : "Built into Codex";
  }
  if (setup.kind === "claude") return "Signed in on claude.ai";
  if (setup.kind === "codex") return "Signed in through ChatGPT";
  if (setup.kind === "opencode") return "From your OpenCode settings";
  if (setup.kind === "local") return "A program on this computer";
  return setup.auth === "key" ? "Key saved on this computer" : "No sign-in needed";
}

const sameAudience = (a: AppAudienceRecord, b: AppAudienceRecord) =>
  a.everyone === b.everyone &&
  a.departmentIds.join() === b.departmentIds.join() &&
  a.agentIds.join() === b.agentIds.join();

type AppAudienceRecord = ConnectorRecord["audience"];

// "Mixed" when its routes were set apart, such as a Codex route that arrived after the Claude one.
export function audienceOf(routes: ConnectorRecord[]): AppAudienceRecord | "mixed" | undefined {
  const [first] = routes;
  if (first === undefined) return undefined;
  return routes.every(({ audience }) => sameAudience(audience, first.audience))
    ? first.audience
    : "mixed";
}

export function permissionOf(routes: ConnectorRecord[]): ConnectorPermission | "mixed" | undefined {
  const [first] = routes;
  if (first === undefined) return undefined;
  return routes.every(({ permission }) => permission === first.permission)
    ? first.permission
    : "mixed";
}

// "Everyone", or the first two names and how many more.
export function whoText(
  audience: AppAudienceRecord | "mixed" | undefined,
  nameOf: (kind: "department" | "agent", id: string) => string | undefined,
): string {
  if (audience === undefined) return "";
  if (audience === "mixed") return "Mixed";
  if (audience.everyone) return "Everyone";
  const names = [
    ...audience.departmentIds.flatMap((id) => nameOf("department", id) ?? []),
    ...audience.agentIds.flatMap((id) => nameOf("agent", id) ?? []),
  ];
  if (names.length === 0) return "No one";
  return names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export const usedAtOf = (routes: ConnectorRecord[]) =>
  routes
    .flatMap(({ usedAt }) => usedAt ?? [])
    .toSorted()
    .at(-1);

// Only Claude gives a page to sign an app in again; Codex and OpenCode do it in their own app.
export const renewsHere = ({ setup }: ConnectorRecord) => setup.kind === "claude";

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
    const entry = entries.find((candidate) => isEntryApp(candidate, connector.setup));
    const key = entry?.setup.slug ?? appKeyOf(connector.setup.name);
    const group = groups.get(key);
    if (group !== undefined) {
      group.routes.push(connector);
      continue;
    }
    groups.set(key, {
      key,
      name: entry?.setup.name ?? displayName(connector.setup.name),
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
  return useApp((state) =>
    Object.values(state.connectors).some((route) => needsRenewing(route) || notAnswering(route)),
  );
}

// Who an app would reach: an agent, or the one a new task is about to start.
export interface AppHolder {
  id: string;
  guest?: true | undefined;
  departmentId?: string | undefined;
  settings: Pick<AgentSettings, "harness" | "accountId">;
}

// The core's rule, so the side panel shows what an agent gets: guests get none, and a provider's
// apps go to its agents only, by the account it is set to (Automatic shows each app once).
export function usableBy(connectors: ConnectorRecord[], agent: AppHolder) {
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
