import { type ConnectorRecord, providerOf } from "@office-town/contract";
import { CircleAlert, ExternalLink, Plus, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import menu from "../../ui/Menu.module.css";
import { showToast } from "../../ui/Toast.tsx";
import library from "../library/Library.module.css";
import { givenToSomeone, withHolder } from "../library/library.ts";
import { AppLogo } from "./AppLogo.tsx";
import { AppStatus } from "./AppStatus.tsx";
import styles from "./Connectors.module.css";
import {
  type AppGroup,
  groupApps,
  isOffer,
  setUpThrough,
  stateOf,
  tagsOf,
  useCatalog,
  useConnectors,
} from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// Each route keeps its own audience, so a department is added to or taken from each one.
async function giveTo(routes: ConnectorRecord[], departmentId: string, on: boolean) {
  try {
    await Promise.all(
      routes.flatMap(({ id, audience }) => {
        const next = withHolder(audience, { departmentId }, on);
        return givenToSomeone(next) ? [api.changeConnector(id, { audience: next })] : [];
      }),
    );
  } catch (failure) {
    showToast(errorText(failure));
  }
}

// A provider the team uses that can sign in to the app itself, to set it up there.
function providerToAdd(group: AppGroup, harnesses: string[]): string | undefined {
  const entry = group.entry;
  if (entry === undefined) return undefined;
  const ways = [providerOf(entry.setup.kind), ...entry.signIn].filter(
    (way): way is string => way !== undefined,
  );
  return ways.find((way) => harnesses.includes(way));
}

interface Reach {
  everyone: boolean;
  byName: boolean;
}

function reachOf(group: AppGroup, departmentId: string, memberIds: string[]): Reach | undefined {
  const everyone = group.routes.some(({ audience }) => audience.everyone);
  const byName = group.routes.some(({ audience }) => audience.departmentIds.includes(departmentId));
  const someone = group.routes.some(({ audience }) =>
    audience.agentIds.some((id) => memberIds.includes(id)),
  );
  return everyone || byName || someone ? { everyone, byName } : undefined;
}

const reachable = (group: AppGroup, harnesses: string[]) =>
  group.routes.some((route) => {
    const provider = providerOf(route.setup.kind);
    return provider === undefined || harnesses.includes(provider);
  });

// An app given to everyone that no member's provider can reach is left out; one given to the team
// or a member stays, with a warning (D-96).
function useTeamApps(departmentId: string, harnesses: string[]) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const agents = useApp((state) => state.agents);
  const memberIds = Object.values(agents)
    .filter((agent) => agent.departmentId === departmentId)
    .map(({ id }) => id);
  const groups = groupApps(connectors, catalog?.entries).filter(
    (group) => !group.routes.every(isOffer),
  );
  const usable = groups.flatMap((group) => {
    const reach = reachOf(group, departmentId, memberIds);
    if (reach === undefined) return [];
    const named = group.routes.some(
      ({ audience }) =>
        audience.departmentIds.includes(departmentId) ||
        audience.agentIds.some((id) => memberIds.includes(id)),
    );
    return named || reachable(group, harnesses) ? [{ group, reach }] : [];
  });
  const others = groups.filter((group) => reachOf(group, departmentId, memberIds) === undefined);
  return { usable, others };
}

// An app only a provider no member uses can reach (D-96), said where the app is listed.
function Unreachable({ group, harnesses }: { group: AppGroup; harnesses: string[] }) {
  const names = useApp((state) => state.harnesses);
  const nameOf = (harness: string) =>
    names.find((known) => known.harness === harness)?.name ?? harness;
  if (reachable(group, harnesses)) return null;
  const only = [...new Set(group.routes.flatMap(({ setup }) => providerOf(setup.kind) ?? []))]
    .map(nameOf)
    .join(" or ");
  const provider = providerToAdd(group, harnesses);
  return (
    <div className={styles.teamWarn}>
      <CircleAlert size={14} aria-hidden />
      <span>Works only on {only}, which no one here uses.</span>
      {provider === undefined ? null : (
        <Button
          onClick={() =>
            setUpThrough(provider, group.entry?.setup.slug ?? group.name).catch(
              (failure: unknown) => showToast(errorText(failure)),
            )
          }
        >
          Set up for {nameOf(provider)}
        </Button>
      )}
    </div>
  );
}

const open = (group: AppGroup) => {
  const [first] = group.routes;
  if (first !== undefined) navigate({ name: "connector", connectorId: first.id });
};

// The Apps section of a department's settings: what the team can use, and giving it more.
export function DepartmentApps({
  departmentId,
  harnesses,
}: {
  departmentId: string;
  // Every member's provider, as now edited.
  harnesses: string[];
}) {
  const { usable, others } = useTeamApps(departmentId, harnesses);
  return (
    <div className={styles.deptApps}>
      {usable.length === 0 ? (
        <p className={styles.empty}>No app yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Apps this team can use">
          {usable.map(({ group, reach }) => (
            <li key={group.key} className={styles.teamAppRow}>
              <span className={styles.teamAppMain}>
                <AppLogo app={group.logo} size="sm" />
                <button type="button" className={styles.rowLink} onClick={() => open(group)}>
                  {group.name}
                </button>
                <ProviderTags tags={tagsOf(group.routes)} />
                <span className={styles.sub}>
                  {reach.everyone ? "Everyone" : reach.byName ? "This team" : "Some members"}
                </span>
                <AppStatus state={stateOf(group.routes)} />
                <span className={styles.raised}>
                  <MoreMenu
                    label={`More for ${group.name}`}
                    menu={() => ({
                      actions: [
                        { label: "Open", icon: ExternalLink, run: () => open(group) },
                        ...(reach.byName && !reach.everyone
                          ? [
                              {
                                label: "Take away from this team",
                                icon: X,
                                run: () => void giveTo(group.routes, departmentId, false),
                              },
                            ]
                          : []),
                      ],
                    })}
                  />
                </span>
              </span>
              <Unreachable group={group} harnesses={harnesses} />
            </li>
          ))}
        </ul>
      )}
      {others.length === 0 ? null : (
        <AddForTeam
          groups={others}
          onPick={(group) => void giveTo(group.routes, departmentId, true)}
        />
      )}
    </div>
  );
}

function AddForTeam({ groups, onPick }: { groups: AppGroup[]; onPick: (group: AppGroup) => void }) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const found = groups
    .filter((group) => group.name.toLowerCase().includes(words))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <DropdownMenu.Root onOpenChange={(opened) => (opened ? undefined : setQuery(""))}>
      <DropdownMenu.Trigger asChild>
        <Button className={styles.seeAll}>
          <Plus size={14} aria-hidden />
          Add an app for this team
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={`${menu.surface} ${styles.pickMenu}`} align="start">
          {groups.length > 8 ? (
            <input
              className={library.menuSearch}
              type="search"
              value={query}
              placeholder="Search apps"
              aria-label="Search apps"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          ) : null}
          {found.map((group) => (
            <DropdownMenu.Item key={group.key} className={menu.item} onSelect={() => onPick(group)}>
              <AppLogo app={group.logo} size="sm" />
              <span className={menu.itemText}>{group.name}</span>
              <ProviderTags tags={tagsOf(group.routes)} named={false} />
            </DropdownMenu.Item>
          ))}
          {found.length === 0 ? <p className={styles.hint}>No app matches.</p> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const PANEL_FIRST = 6;

// The Office panel's short list: every app the team can use, logos only.
export function DepartmentAppList({
  departmentId,
  harnesses,
}: {
  departmentId: string;
  harnesses: string[];
}) {
  const { usable } = useTeamApps(departmentId, harnesses);
  const [all, setAll] = useState(false);
  if (usable.length === 0) return <p className={styles.hint}>No app yet.</p>;
  const shown = all ? usable : usable.slice(0, PANEL_FIRST);
  return (
    <div className={styles.deptApps}>
      {shown.map(({ group }) => (
        <div key={group.key}>
          <button type="button" className={styles.appRow} onClick={() => open(group)}>
            <AppLogo app={group.logo} size="sm" />
            <span>{group.name}</span>
            <ProviderTags tags={tagsOf(group.routes)} named={false} />
          </button>
          <Unreachable group={group} harnesses={harnesses} />
        </div>
      ))}
      {shown.length < usable.length ? (
        <button type="button" className={styles.textLink} onClick={() => setAll(true)}>
          Show all {usable.length}
        </button>
      ) : null}
    </div>
  );
}

export const useTeamAppCount = (departmentId: string, harnesses: string[]) =>
  useTeamApps(departmentId, harnesses).usable.length;
