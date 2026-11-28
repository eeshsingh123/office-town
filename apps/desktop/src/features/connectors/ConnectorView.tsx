import {
  type ConnectorAction,
  type ConnectorActivityPeriod,
  type ConnectorCall,
  type ConnectorChange,
  type ConnectorRecord,
  claudeConnectorsPage,
  providerOf,
} from "@office-town/contract";
import { Globe, KeyRound, Monitor, Power, SquareArrowOutUpRight, Unplug } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { knowAgents } from "../../store/live.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ClearFilters } from "../../ui/ClearFilters.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Count } from "../../ui/Count.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { ago, clockTime, taskName } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AudienceMenu, useHolders } from "../library/GivenToMenu.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { ActionGroups } from "./ActionGroups.tsx";
import { AppLogo } from "./AppLogo.tsx";
import { AppStatus } from "./AppStatus.tsx";
import styles from "./Connectors.module.css";
import {
  type AppGroup,
  audienceOf,
  groupApps,
  isProviderApp,
  needsRenewing,
  PERMISSIONS,
  permissionOf,
  permissionTitle,
  setUpThrough,
  sourceLine,
  stateOf,
  useCatalog,
  useConnectors,
  usedAtOf,
} from "./connectors.ts";
import { RenewAction } from "./RenewAction.tsx";

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

async function changeAll(routes: ConnectorRecord[], update: ConnectorChange) {
  try {
    await Promise.all(routes.map(({ id }) => api.changeConnector(id, update)));
  } catch (failure) {
    showToast(errorText(failure));
  }
}

function SharedIcon({ route }: { route: ConnectorRecord }) {
  return (
    <span className={`${styles.logo} ${styles.sm}`} aria-hidden>
      {route.setup.kind === "local" ? (
        <Monitor size={14} />
      ) : route.setup.auth === "key" ? (
        <KeyRound size={14} />
      ) : (
        <Globe size={14} />
      )}
    </span>
  );
}

// One row per provider: where the app works, each account it is on, and where it could be added.
function Providers({ group, mixed }: { group: AppGroup; mixed: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useApp((state) => state.harnessStatuses);
  const accounts = useApp((state) => state.accounts);
  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const shared = group.routes.filter((route) => !isProviderApp(route));
  const byProvider = new Map<string, ConnectorRecord[]>();
  for (const route of group.routes) {
    const provider = providerOf(route.setup.kind);
    if (provider !== undefined)
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), route]);
  }
  const entry = group.entry;
  const ways = entry === undefined ? [] : [providerOf(entry.setup.kind), ...entry.signIn];
  const missing = harnesses
    .map(({ harness }) => harness)
    .filter(
      (harness) =>
        !byProvider.has(harness) &&
        ways.includes(harness) &&
        statuses?.[harness]?.installed !== false,
    );
  const permissionLine = (routes: ConnectorRecord[]) => {
    const permission = permissionOf(routes);
    return mixed && permission !== undefined && permission !== "mixed"
      ? ` · ${permissionTitle(permission)}`
      : "";
  };
  return (
    <div className={styles.list}>
      {shared.map((route) => (
        <div key={route.id} className={styles.routeRow}>
          <SharedIcon route={route} />
          <span className={styles.connText}>
            <span className={styles.connName}>Any provider</span>
            <span className={styles.sub}>
              {[byProvider.size > 0 ? "Used first" : "", sourceLine(route)]
                .filter((part) => part !== "")
                .join(" · ")}
              {permissionLine([route])}
            </span>
          </span>
          <AppStatus state={stateOf([route])} />
        </div>
      ))}
      {[...byProvider.entries()].map(([provider, routes]) => {
        const [first] = routes;
        const names = routes.flatMap(
          ({ setup }) => accounts.find(({ id }) => id === setup.account)?.name ?? [],
        );
        const renewing = routes.find(needsRenewing);
        return first === undefined ? null : (
          <div key={provider} className={styles.routeRow}>
            <ProviderLogo harness={provider} size="sm" />
            <span className={styles.connText}>
              <span className={styles.connName}>{nameOf(provider)}</span>
              <span className={styles.sub}>
                {sourceLine(first)}
                {names.length > 1 ? ` · ${names.join(" and ")}` : ""}
                {permissionLine(routes)}
              </span>
            </span>
            <span className={styles.rowEnd}>
              <AppStatus state={stateOf(routes)} />
              {renewing === undefined ? null : <RenewAction route={renewing} label="Renew" />}
            </span>
          </div>
        );
      })}
      {missing.map((provider) => (
        <div key={provider} className={styles.routeRow}>
          <ProviderLogo harness={provider} size="sm" />
          <span className={styles.connText}>
            <span className={styles.connName}>{nameOf(provider)}</span>
            <span className={styles.sub}>Not set up on this provider</span>
          </span>
          <Button
            onClick={() =>
              setUpThrough(provider, entry?.setup.slug ?? group.name).catch((failure: unknown) =>
                showToast(errorText(failure)),
              )
            }
          >
            Set up in {nameOf(provider)}
          </Button>
        </div>
      ))}
      {entry === undefined ||
      shared.length > 0 ||
      providerOf(entry.setup.kind) !== undefined ? null : (
        <div className={styles.routeRow}>
          <span className={`${styles.logo} ${styles.sm}`} aria-hidden>
            <Globe size={14} />
          </span>
          <span className={styles.connText}>
            <span className={styles.connName}>Any provider</span>
            <span className={styles.sub}>Not set up</span>
          </span>
          <Button onClick={() => navigate({ name: "connectors", connect: entry.setup.slug })}>
            Set up
          </Button>
        </div>
      )}
    </div>
  );
}

const OUTCOMES: Record<ConnectorCall["outcome"], string> = {
  done: "",
  refused: "Not allowed",
  failed: "Failed",
  asked: "Needs you",
};

function CallRow({ call }: { call: ConnectorCall }) {
  const agent = useApp((state) => state.agents[call.agentId]);
  const team = useApp((state) =>
    call.departmentId === undefined ? undefined : state.departments[call.departmentId],
  );
  const task = useApp((state) => state.tasks[call.taskId]?.task);
  const outcome = OUTCOMES[call.outcome] || (call.change ? "Changed" : "Read");
  return (
    <li>
      <button
        type="button"
        className={styles.actRow}
        onClick={() => navigate({ name: "task", taskId: call.taskId })}
      >
        <Avatar name={agent?.name ?? "?"} colour={agent?.colour ?? "#736d64"} size={28} />
        <span className={styles.connText}>
          <code className={styles.actionName}>{call.tool}</code>
          <span className={styles.sub}>
            {[agent?.name ?? "An agent", team?.name, task === undefined ? "" : taskName(task)]
              .filter((part) => part !== undefined && part !== "")
              .join(" · ")}
          </span>
        </span>
        <span className={styles.when}>
          <span className={styles.badge}>{outcome}</span>
          {clockTime(call.at)}
        </span>
      </button>
    </li>
  );
}

const SHORT = 5;

const PERIODS: { value: ConnectorActivityPeriod; label: string; within: string }[] = [
  { value: "week", label: "This week", within: "this week" },
  { value: "month", label: "Last 30 days", within: "in the last 30 days" },
  { value: "all", label: "Last 90 days", within: "in the last 90 days" },
];
const within = (period: ConnectorActivityPeriod) =>
  PERIODS.find((one) => one.value === period)?.within ?? "";

interface Activity {
  calls: ConnectorCall[];
  total: number;
  teams: string[];
  next: Record<string, number | undefined>;
}

interface Filters {
  period: ConnectorActivityPeriod;
  team: string;
  changes: boolean;
}

const queryOf = ({ period, team, changes }: Filters) => ({
  ...(period === "week" ? {} : { period }),
  ...(team === "" ? {} : { team }),
  ...(changes ? { changes } : {}),
});

// The period's calls through every way in, newest first, by team and changes only on request.
function useActivity(routes: ConnectorRecord[], { period, team, changes }: Filters) {
  const [activity, setActivity] = useState<Activity>();
  const ids = routes.map(({ id }) => id).join(",");
  useEffect(() => {
    let current = true;
    const routeIds = ids.split(",");
    const query = queryOf({ period, team, changes });
    Promise.all(routeIds.map((id) => api.connectorActivity(id, query))).then(
      (pages) => {
        if (!current) return;
        const calls = pages.flatMap((read) => read.calls);
        knowAgents(calls.map((call) => call.agentId)).catch(() => undefined);
        setActivity({
          calls: calls.toSorted((a, b) => b.at.localeCompare(a.at)),
          total: pages.reduce((sum, read) => sum + read.total, 0),
          teams: [
            ...new Set(
              pages.flatMap((read) => read.teams.map((one) => one.departmentId ?? "none")),
            ),
          ],
          next: Object.fromEntries(routeIds.map((id, index) => [id, pages[index]?.next])),
        });
      },
      (failure: unknown) => showToast(errorText(failure)),
    );
    return () => {
      current = false;
    };
  }, [ids, period, team, changes]);
  const more = async () => {
    if (activity === undefined) return;
    const query = queryOf({ period, team, changes });
    const pages = await Promise.all(
      Object.entries(activity.next)
        .filter(([, before]) => before !== undefined)
        .map(
          async ([id, before]) =>
            [id, await api.connectorActivity(id, { ...query, before })] as const,
        ),
    );
    const older = pages.flatMap(([, read]) => read.calls);
    knowAgents(older.map((call) => call.agentId)).catch(() => undefined);
    setActivity({
      ...activity,
      calls: [...activity.calls, ...older].toSorted((a, b) => b.at.localeCompare(a.at)),
      next: {
        ...activity.next,
        ...Object.fromEntries(pages.map(([id, read]) => [id, read.next])),
      },
    });
  };
  return { activity, more };
}

// "Today", "Yesterday", a weekday in the past week, then "12 Nov" ("12 Nov 2025" in another year).
function dayOf(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString([], { weekday: "long" });
  return at.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

// Grouped under a heading per day, so a long stretch reads as a timeline.
function RecentUse({
  activity,
  more,
  period,
}: ReturnType<typeof useActivity> & { period: ConnectorActivityPeriod }) {
  const [shown, setShown] = useState(SHORT);
  if (activity === undefined) return null;
  const hasMore =
    shown < activity.calls.length ||
    Object.values(activity.next).some((before) => before !== undefined);
  if (activity.calls.length === 0) {
    return <p className={styles.empty}>Not used {within(period)}.</p>;
  }
  const calls = activity.calls.slice(0, shown);
  return (
    <ul className={styles.list} aria-label="Recent use">
      {calls.map((call, index) => {
        const day = dayOf(call.at);
        const previous = calls[index - 1];
        return (
          <Fragment key={call.id}>
            {previous !== undefined && dayOf(previous.at) === day ? null : (
              <li className={styles.day}>{day}</li>
            )}
            <CallRow call={call} />
          </Fragment>
        );
      })}
      {hasMore ? (
        <li className={styles.more}>
          <Button
            variant="ghost"
            onClick={() => {
              const wanted = shown + 10;
              setShown(wanted);
              if (wanted > activity.calls.length) void more();
            }}
          >
            Show more
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

// "failed" when the app's actions cannot be read; the section says so in place.
function useActions(routes: ConnectorRecord[]): ConnectorAction[] | "failed" | undefined {
  const [actions, setActions] = useState<ConnectorAction[] | "failed">();
  const source = routes.toSorted((a, b) => b.actions - a.actions)[0];
  const sourceId = source?.id;
  const count = source?.actions ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when its count changes, such as an OpenCode action seen for the first time.
  useEffect(() => {
    if (sourceId === undefined) return;
    let current = true;
    api.connectorActions(sourceId).then(
      (read) => {
        if (current) setActions(read);
      },
      () => {
        if (current) setActions("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [sourceId, count]);
  return actions;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function ConnectorView({ connectorId }: { connectorId: string }) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const holders = useHolders();
  const harnesses = useApp((state) => state.harnesses);
  const departments = useApp((state) => state.departments);
  const [confirming, setConfirming] = useState(false);
  const [period, setPeriod] = useState<ConnectorActivityPeriod>("week");
  const [team, setTeam] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const group = groupApps(connectors, catalog?.entries).find(({ routes }) =>
    routes.some(({ id }) => id === connectorId),
  );
  const routes = group?.routes ?? [];
  const actions = useActions(routes);
  const use = useActivity(routes, { period, team, changes: changesOnly });
  const [main] = routes;
  if (group === undefined || main === undefined) {
    return (
      <section className={page.page}>
        <p className={styles.empty}>This app was removed.</p>
      </section>
    );
  }
  const shared = routes.filter((route) => !isProviderApp(route));
  const enabled = routes.some((route) => route.enabled);
  const state = stateOf(routes);
  const offer = state === "offer";
  const permission = permissionOf(routes);
  const audience = audienceOf(routes);
  const mixed = permission === "mixed" || audience === "mixed";
  const onlyOpenCode = routes.every(({ setup }) => setup.kind === "opencode");
  const usedAt = usedAtOf(routes);
  const claude = routes.find(({ setup }) => setup.kind === "claude");
  const providerName = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const managedIn = [
    ...new Set(routes.flatMap(({ setup }) => providerOf(setup.kind) ?? [])),
  ].filter((provider) => provider !== "claude");
  const renewing = routes.find(needsRenewing);
  const lead = [
    group.entry?.description.replace(/\.$/, ""),
    offer || use.activity === undefined || use.activity.total === 0
      ? undefined
      : `${plural(use.activity.total, "call")} ${within(period)}`,
    offer ? undefined : usedAt === undefined ? "Never used" : `last used ${ago(usedAt)}`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <section className={page.page} aria-labelledby="connector-title">
      <div className={styles.column}>
        <Crumbs
          items={[{ label: "Connectors", view: { name: "connectors" } }, { label: group.name }]}
        />
        <header className={styles.detailHead}>
          <AppLogo app={group.logo} size="lg" />
          <span className={styles.detailText}>
            <h1 id="connector-title" className={page.title}>
              {group.name}
            </h1>
            {lead === "" ? null : <p className={page.lead}>{lead}</p>}
          </span>
          <span className={styles.rowEnd}>
            <AppStatus state={state} />
            {offer ? (
              <RenewAction route={main} label="Set up" primary />
            ) : renewing !== undefined ? (
              <RenewAction route={renewing} label="Renew" primary />
            ) : state === "off" ? (
              <Button onClick={() => void changeAll(routes, { enabled: true })}>Turn on</Button>
            ) : null}
          </span>
          {offer ? null : (
            <MoreMenu
              label={`More for ${group.name}`}
              menu={() => ({
                actions: [
                  {
                    label: enabled ? "Turn off" : "Turn on",
                    icon: Power,
                    run: () => changeAll(routes, { enabled: !enabled }),
                  },
                  ...(claude === undefined
                    ? []
                    : [
                        {
                          label: "Remove on claude.ai",
                          icon: SquareArrowOutUpRight,
                          run: () => {
                            window.open(claudeConnectorsPage, "_blank", "noopener");
                          },
                        },
                      ]),
                  ...(shared.length === 0
                    ? []
                    : [
                        {
                          label: "Disconnect",
                          icon: Unplug,
                          danger: true,
                          run: () => setConfirming(true),
                        },
                      ]),
                ],
              })}
            />
          )}
        </header>

        {offer ? (
          <p className={styles.sub}>Set it up to choose who can use it and to see its actions.</p>
        ) : (
          <>
            <div className={styles.list}>
              <div className={styles.accessRow}>
                <span className={styles.accessKey}>Permission</span>
                <span>
                  <fieldset className={styles.segments}>
                    <legend className="visually-hidden">Permission</legend>
                    {PERMISSIONS.map(({ value, title, description }) => (
                      <button
                        key={value}
                        type="button"
                        title={description}
                        aria-pressed={permission === value}
                        onClick={() => void changeAll(routes, { permission: value })}
                      >
                        {title}
                      </button>
                    ))}
                  </fieldset>
                  {permission === "mixed" ? (
                    <p className={styles.hint}>Mixed: each provider's is under Providers.</p>
                  ) : onlyOpenCode ? (
                    <p className={styles.hint}>
                      OpenCode can't tell reads from changes, so Ask me first asks before every
                      action.
                    </p>
                  ) : null}
                </span>
              </div>
              <div className={styles.accessRow}>
                <span className={styles.accessKey}>Who can use it</span>
                <span>
                  <AudienceMenu
                    audience={
                      audience === "mixed" || audience === undefined ? main.audience : audience
                    }
                    {...(audience === "mixed" ? { summary: "Mixed" } : {})}
                    holders={holders}
                    onChange={(next) => void changeAll(routes, { audience: next })}
                    everyone="Every agent, in any department"
                    empty="There are no departments yet."
                    label="Who can use it:"
                  />
                </span>
              </div>
            </div>

            <div className={page.section}>
              <div className={page.sectionHead}>
                <h2 className={page.sectionTitle}>Providers</h2>
              </div>
              <Providers group={group} mixed={mixed} />
              {managedIn.length === 0 ? null : (
                <p className={styles.hint}>
                  Managed in {managedIn.map(providerName).join(" and ")}. Remove it there.
                </p>
              )}
            </div>

            <div className={page.section}>
              <div className={page.sectionHead}>
                <h2 className={page.sectionTitle}>
                  What agents can do
                  {Array.isArray(actions) && actions.length > 0 ? (
                    <Count value={actions.length} />
                  ) : null}
                </h2>
              </div>
              {actions === undefined ? (
                <p className={styles.sub}>Reading its actions</p>
              ) : actions === "failed" ? (
                <p className={styles.sub}>Could not read this app's actions.</p>
              ) : (
                <ActionGroups actions={actions} />
              )}
            </div>

            <div className={page.section}>
              <div className={page.sectionHead}>
                <h2 className={page.sectionTitle}>Recent use</h2>
                {usedAt === undefined ? null : (
                  <span className={styles.rowEnd}>
                    <ChoiceMenu
                      label="Period"
                      value={period}
                      choices={PERIODS}
                      onChange={setPeriod}
                    />
                    {use.activity === undefined || use.activity.total === 0 ? null : (
                      <>
                        <ChoiceMenu
                          label="Team"
                          value={team}
                          choices={[
                            { value: "", label: "All" },
                            // The chosen team stays listed when the period has no calls from it.
                            ...[
                              ...new Set([...use.activity.teams, ...(team === "" ? [] : [team])]),
                            ].map((id) => ({
                              value: id,
                              label:
                                id === "none" ? "No team" : (departments[id]?.name ?? "A team"),
                            })),
                          ]}
                          onChange={setTeam}
                        />
                        <button
                          type="button"
                          className={`${styles.toggleChip} ${changesOnly ? styles.toggleOn : ""}`}
                          aria-pressed={changesOnly}
                          onClick={() => setChangesOnly(!changesOnly)}
                        >
                          Only changes
                        </button>
                        <ClearFilters
                          shown={team !== "" || changesOnly}
                          onClear={() => {
                            setTeam("");
                            setChangesOnly(false);
                          }}
                        />
                      </>
                    )}
                  </span>
                )}
              </div>
              <RecentUse key={period} {...use} period={period} />
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${group.name}?`}
        description="Agents can't use it through Office Town any more, and its key is deleted from this computer."
        confirmLabel="Disconnect"
        onConfirm={async () => {
          await Promise.all(shared.map(({ id }) => api.removeConnector(id)));
          navigate({ name: "connectors" });
        }}
      />
    </section>
  );
}
