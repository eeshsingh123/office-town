import type { Audience, CatalogEntry, ConnectorRecord } from "@office-town/contract";
import { ChevronDown, ChevronRight, ExternalLink, Plus, Power } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { forSession, useKept, useKeptScroll } from "../../store/kept.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ClearFilters } from "../../ui/ClearFilters.tsx";
import { ago } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { TabRow } from "../../ui/TabRow.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { AddSheet } from "./AddSheet.tsx";
import { AppLogo } from "./AppLogo.tsx";
import { AppStatus } from "./AppStatus.tsx";
import styles from "./Connectors.module.css";
import {
  type AppGroup,
  type AppState,
  audienceOf,
  entryTags,
  groupApps,
  isCodexOwn,
  isOffer,
  needsRenewing,
  needsUser,
  PERMISSIONS,
  permissionOf,
  permissionTitle,
  refreshApps,
  sourceLine,
  stateOf,
  tagsOf,
  useCatalog,
  useConnectors,
  usedAtOf,
  whoText,
} from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";
import { RenewAction } from "./RenewAction.tsx";
import { UpdatesSection } from "./UpdatesSection.tsx";

interface ConnectorsViewProps {
  // An app to set up at once, by slug or name, such as one an agent asked for.
  connect?: string;
  audience?: Audience;
  // A place to point at in Updates, by id.
  place?: string;
}

type Tab = "all" | "needs" | "off";
type GroupBy = "none" | "provider" | "status" | "who";

interface Filters {
  tab: Tab;
  query: string;
  // "" for every provider; "all" for apps every provider uses.
  provider: string;
  // "" for anyone; "everyone", or a department id.
  who: string;
  permission: string;
}

const NO_FILTERS: Filters = { tab: "all", query: "", provider: "", who: "", permission: "" };
const FILTERS = forSession("connectors.filters", NO_FILTERS);
const GROUP = forSession<GroupBy>("connectors.group-by", "none");
const CODEX_OPEN = forSession("connectors.codex-open", false);

const GROUP_BY: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "provider", label: "Provider" },
  { value: "status", label: "Status" },
  { value: "who", label: "Who can use it" },
];

const STATE_ORDER: AppState[] = ["renew", "failing", "ready", "off"];
const STATE_GROUP: Record<AppState, string> = {
  renew: "Needs you",
  failing: "Needs you",
  ready: "Ready",
  off: "Turned off",
  offer: "Not set up",
};

// A short Suggested list helps a new user; past this many apps, Add is the place to find more.
const NEW_USER_APPS = 6;
const SUGGESTED = 8;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

async function turn(routes: ConnectorRecord[], enabled: boolean) {
  try {
    await Promise.all(routes.map(({ id }) => api.changeConnector(id, { enabled })));
  } catch (failure) {
    showToast(errorText(failure));
  }
}

function useNameOf() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  return (kind: "department" | "agent", id: string) =>
    kind === "department" ? departments[id]?.name : agents[id]?.name;
}

function AppRow({ group }: { group: AppGroup }) {
  const nameOf = useNameOf();
  const state = stateOf(group.routes);
  const renewing = group.routes.find(needsRenewing);
  const permission = permissionOf(group.routes);
  const usedAt = usedAtOf(group.routes);
  const enabled = group.routes.some(({ enabled }) => enabled);
  const [first] = group.routes;
  if (first === undefined) return null;
  return (
    <li className={`${styles.appListRow} ${needsUser(group.routes) ? styles.needRow : ""}`}>
      <AppLogo app={group.logo} />
      <span className={styles.connText}>
        <button
          type="button"
          className={styles.rowLink}
          onClick={() => navigate({ name: "connector", connectorId: first.id })}
        >
          {group.name}
        </button>
        <span className={styles.sub}>{group.entry?.description ?? sourceLine(first)}</span>
      </span>
      <span className={styles.cell}>
        <ProviderTags tags={tagsOf(group.routes)} />
      </span>
      <span className={`${styles.cell} ${styles.sub}`}>
        {whoText(audienceOf(group.routes), nameOf)}
      </span>
      <span className={`${styles.cell} ${styles.sub} ${styles.wide}`}>
        {permission === undefined
          ? ""
          : permission === "mixed"
            ? "Mixed"
            : permissionTitle(permission)}
      </span>
      <span className={`${styles.cell} ${styles.statusCell}`}>
        <AppStatus state={state} />
        {renewing === undefined ? null : <RenewAction route={renewing} label="Renew" />}
      </span>
      <span className={`${styles.cell} ${styles.sub} ${styles.wide}`}>
        {usedAt === undefined ? "Never" : ago(usedAt)}
      </span>
      <span className={styles.raised}>
        <MoreMenu
          label={`More for ${group.name}`}
          menu={() => ({
            actions: [
              {
                label: "Open",
                icon: ExternalLink,
                run: () => navigate({ name: "connector", connectorId: first.id }),
              },
              {
                label: enabled ? "Turn off" : "Turn on",
                icon: Power,
                run: () => void turn(group.routes, !enabled),
              },
            ],
          })}
        />
      </span>
    </li>
  );
}

function AppList({ groups, label }: { groups: AppGroup[]; label: string }) {
  return (
    <ul className={styles.appList} aria-label={label}>
      {groups.map((group) => (
        <AppRow key={group.key} group={group} />
      ))}
    </ul>
  );
}

// Codex's own tools, folded so they do not sit among the apps the user connected.
function CodexFold({ groups }: { groups: AppGroup[] }) {
  const [open, setOpen] = useKept(CODEX_OPEN);
  if (groups.length === 0) return null;
  return (
    <div className={styles.fold}>
      <button
        type="button"
        className={styles.foldHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown size={14} className={styles.caret} aria-hidden />
        ) : (
          <ChevronRight size={14} className={styles.caret} aria-hidden />
        )}
        <ProviderLogo harness="codex" size="sm" />
        <span className={styles.foldTitle}>From your Codex settings</span>
        <span className={styles.sub}>
          {groups.length} {groups.length === 1 ? "app" : "apps"}:{" "}
          {groups.map(({ name }) => name).join(", ")}
        </span>
      </button>
      {open ? <AppList groups={groups} label="From your Codex settings" /> : null}
    </div>
  );
}

// An app not set up yet: one from the vetted list, or one a provider offers before its sign-in.
function SuggestedRow(props: {
  name: string;
  logo: string;
  description: string | undefined;
  tags: string[];
  action: ReactNode;
}) {
  return (
    <li className={styles.connRow}>
      <AppLogo app={props.logo} />
      <span className={styles.connText}>
        <span className={styles.connName}>{props.name}</span>
        <span className={styles.sub}>{props.description}</span>
      </span>
      <span className={styles.rowEnd}>
        <ProviderTags tags={props.tags} />
        {props.action}
      </span>
    </li>
  );
}

function groupKey(group: AppGroup, by: GroupBy, who: (group: AppGroup) => string): string {
  if (by === "status") return STATE_GROUP[stateOf(group.routes)];
  if (by === "who") return who(group);
  return tagsOf(group.routes).join(",");
}

export function ConnectorsView(props: ConnectorsViewProps) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const harnesses = useApp((state) => state.harnesses);
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const nameOf = useNameOf();
  const [filters, setFilters] = useKept(FILTERS);
  const [by, setBy] = useKept(GROUP);
  const scroll = useKeptScroll("connectors");
  const [adding, setAdding] = useState<{ app?: string; audience?: Audience } | null>();
  // An app asked for opens once, unless the user has closed it since.
  const sheet =
    adding === undefined
      ? props.connect === undefined
        ? null
        : {
            app: props.connect,
            ...(props.audience === undefined ? {} : { audience: props.audience }),
          }
      : adding;
  // Provider apps signed in since are read on opening and on coming back to the app.
  useEffect(() => {
    refreshApps();
    window.addEventListener("focus", refreshApps);
    return () => window.removeEventListener("focus", refreshApps);
  }, []);
  const update = (next: Partial<Filters>) => setFilters({ ...filters, ...next });

  const entries = catalog?.entries ?? [];
  const groups = groupApps(connectors, entries);
  const offerGroups = groups.filter((group) => group.routes.every(isOffer));
  const mine = groups.filter((group) => !group.routes.every(isOffer));
  const counts: Record<Tab, number> = {
    all: mine.length,
    needs: mine.filter((group) => needsUser(group.routes)).length,
    off: mine.filter((group) => stateOf(group.routes) === "off").length,
  };

  const words = filters.query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(words);
  // A department can use an app given to everyone, to it, or to one of its members.
  const reaches = (group: AppGroup) =>
    filters.who === "" ||
    group.routes.some(({ audience }) =>
      filters.who === "everyone"
        ? audience.everyone
        : audience.everyone ||
          audience.departmentIds.includes(filters.who) ||
          audience.agentIds.some((id) => agents[id]?.departmentId === filters.who),
    );
  const shown = mine
    .filter((group) =>
      filters.tab === "needs"
        ? needsUser(group.routes)
        : filters.tab === "off"
          ? stateOf(group.routes) === "off"
          : true,
    )
    .filter((group) =>
      matches(
        `${group.name} ${group.entry?.description ?? ""} ${group.routes.map(({ setup }) => setup.name).join(" ")}`,
      ),
    )
    .filter((group) => {
      if (filters.provider === "") return true;
      const tags = tagsOf(group.routes);
      // An app every provider uses works for this one too.
      return (
        tags.includes(filters.provider) || (filters.provider !== "all" && tags.includes("all"))
      );
    })
    .filter(reaches)
    .filter(
      (group) => filters.permission === "" || permissionOf(group.routes) === filters.permission,
    )
    .toSorted(
      (a, b) =>
        Number(needsUser(b.routes)) - Number(needsUser(a.routes)) || a.name.localeCompare(b.name),
    );
  const codexOwn = shown.filter((group) => group.routes.every(isCodexOwn));
  const listed = shown.filter((group) => !group.routes.every(isCodexOwn));
  const narrowing =
    filters.query !== "" ||
    filters.provider !== "" ||
    filters.who !== "" ||
    filters.permission !== "";

  const providers = [...new Set(mine.flatMap((group) => tagsOf(group.routes)))].toSorted(
    (a, b) => Number(a !== "all") - Number(b !== "all") || a.localeCompare(b),
  );
  const providerName = (tag: string) =>
    tag === "all"
      ? "Any provider"
      : (harnesses.find(({ harness }) => harness === tag)?.name ?? tag);
  const who = (group: AppGroup) => whoText(audienceOf(group.routes), nameOf);
  const sections =
    by === "none"
      ? [{ key: "", title: "", groups: listed }]
      : [
          ...listed
            .reduce((all, group) => {
              const key = groupKey(group, by, who);
              all.set(key, [...(all.get(key) ?? []), group]);
              return all;
            }, new Map<string, AppGroup[]>())
            .entries(),
        ]
          .map(([key, list]) => ({
            key,
            title: by === "provider" ? key.split(",").map(providerName).join(" and ") : key,
            groups: list,
          }))
          .toSorted((a, b) =>
            by === "status"
              ? STATE_ORDER.findIndex((state) => STATE_GROUP[state] === a.key) -
                STATE_ORDER.findIndex((state) => STATE_GROUP[state] === b.key)
              : a.title.localeCompare(b.title),
          );

  // Suggested only while the user has few apps; Add holds every app either way.
  const known = new Set(groups.map(({ key }) => key));
  const unseen = entries.filter((entry) => !known.has(entry.setup.slug));
  const suggestedEntries = unseen.slice(0, Math.max(0, SUGGESTED - offerGroups.length));
  const suggesting = catalog !== undefined && mine.length < NEW_USER_APPS;

  return (
    <section
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className={page.page}
      aria-labelledby="connectors-title"
    >
      <div className={styles.column}>
        <PageHeader
          id="connectors-title"
          title="Connectors"
          lead="Apps your agents can use, and the places your updates go to."
          actions={
            <Button variant="primary" data-tour="connectors-add" onClick={() => setAdding({})}>
              <Plus size={14} aria-hidden />
              Add app
            </Button>
          }
        />

        {mine.length === 0 ? null : (
          <div className={styles.tools}>
            <TabRow
              label="Show"
              tabs={[
                { value: "all", label: "All", count: counts.all },
                {
                  value: "needs",
                  label: "Needs you",
                  count: counts.needs,
                  urgent: counts.needs > 0,
                },
                { value: "off", label: "Turned off", count: counts.off },
              ]}
              value={filters.tab}
              onChange={(tab) => update({ tab })}
            />
            <div className={styles.filters}>
              <SearchBox
                value={filters.query}
                onChange={(query) => update({ query })}
                label="Search apps"
              />
              <ChoiceMenu
                label="Provider"
                value={filters.provider}
                choices={[
                  { value: "", label: "All" },
                  ...providers.map((tag) => ({ value: tag, label: providerName(tag) })),
                ]}
                onChange={(provider) => update({ provider })}
              />
              <ChoiceMenu
                label="Who can use it"
                value={filters.who}
                choices={[
                  { value: "", label: "All" },
                  { value: "everyone", label: "Everyone" },
                  ...Object.values(departments)
                    .toSorted((a, b) => a.name.localeCompare(b.name))
                    .map((department) => ({ value: department.id, label: department.name })),
                ]}
                onChange={(next) => update({ who: next })}
              />
              <ChoiceMenu
                label="Permission"
                value={filters.permission}
                choices={[
                  { value: "", label: "All" },
                  ...PERMISSIONS.map(({ value, title }) => ({ value, label: title })),
                ]}
                onChange={(permission) => update({ permission })}
              />
              <ClearFilters
                shown={narrowing}
                onClear={() => setFilters({ ...NO_FILTERS, tab: filters.tab })}
              />
              <span className={styles.spacer} />
              <ChoiceMenu label="Group by" value={by} choices={GROUP_BY} onChange={setBy} />
            </div>
          </div>
        )}

        {mine.length === 0 ? null : shown.length === 0 ? (
          <div className={styles.emptyBox}>
            <p className={styles.emptyTitle}>
              {narrowing
                ? "No app matches."
                : filters.tab === "needs"
                  ? "No app needs you."
                  : "No app is turned off."}
            </p>
            {narrowing ? (
              <button
                type="button"
                className={styles.textLink}
                onClick={() => setFilters({ ...NO_FILTERS, tab: filters.tab })}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className={styles.listBlock}>
            <div className={styles.listHead} aria-hidden>
              <span />
              <span>App</span>
              <span>Works on</span>
              <span>Who can use it</span>
              <span className={styles.wide}>Permission</span>
              <span>Status</span>
              <span className={styles.wide}>Last used</span>
              <span />
            </div>
            {sections.map((section) =>
              section.groups.length === 0 ? null : (
                <div key={section.key} className={styles.listSection}>
                  {section.title === "" ? null : (
                    <h2 className={styles.groupTitle}>
                      {section.title}{" "}
                      <span className={styles.chipCount}>{section.groups.length}</span>
                    </h2>
                  )}
                  <AppList groups={section.groups} label={section.title || "Your apps"} />
                </div>
              ),
            )}
            <CodexFold groups={codexOwn} />
          </div>
        )}

        <UpdatesSection place={props.place} />

        {suggesting ? (
          <div className={page.section}>
            <div className={page.sectionHead}>
              <h2 className={page.sectionTitle}>Suggested</h2>
            </div>
            <ul className={styles.list} aria-label="Suggested apps">
              {offerGroups.map((group) => {
                const [route] = group.routes;
                return route === undefined ? null : (
                  <SuggestedRow
                    key={group.key}
                    name={group.name}
                    logo={group.logo}
                    description={group.entry?.description}
                    tags={tagsOf(group.routes)}
                    action={<RenewAction route={route} label="Set up" />}
                  />
                );
              })}
              {suggestedEntries.map((entry: CatalogEntry) => (
                <SuggestedRow
                  key={entry.setup.slug}
                  name={entry.setup.name}
                  logo={entry.setup.slug}
                  description={entry.description}
                  tags={entryTags(entry)}
                  action={
                    <Button
                      onClick={() => setAdding({ app: entry.setup.slug })}
                      aria-label={`Set up ${entry.setup.name}`}
                    >
                      Set up
                    </Button>
                  }
                />
              ))}
            </ul>
            <Button variant="ghost" className={styles.seeAll} onClick={() => setAdding({})}>
              See all {entries.length + offerGroups.length} apps
            </Button>
          </div>
        ) : null}
      </div>
      {sheet === null ? null : (
        <AddSheet
          keysAt={catalog?.keys ?? "store"}
          entries={entries}
          groups={groups}
          {...(sheet.app === undefined ? {} : { app: sheet.app })}
          {...(sheet.audience === undefined ? {} : { audience: sheet.audience })}
          onClose={() => setAdding(null)}
        />
      )}
    </section>
  );
}
