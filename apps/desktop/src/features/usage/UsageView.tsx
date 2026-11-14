import type { Account, AccountUsage } from "@office-town/contract";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { forSession, useKept } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ago, compactCount } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { isReady, useHarnessStatuses } from "../providers/providers.ts";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { AgentsCell } from "./AgentsCell.tsx";
import { estimateOf, estimateText, tokensOf, useAccountUsers, useSpend } from "./accounts.tsx";
import { accountLabel, planName, useIdentities, useReadIdentities } from "./identity.ts";
import table from "./LimitsTable.module.css";
import { type LimitRow, LimitsTable, type Sort, sortRows } from "./LimitsTable.tsx";
import { clock, currentLimits, fullest, inTime, runsOutAt, windowLabel } from "./limits.ts";
import { Meter } from "./Meter.tsx";
import styles from "./Usage.module.css";
import { UsagePauses } from "./UsagePauses.tsx";
import { reloadAccounts, useLimitStops, useLiveLimits, useMinute } from "./use-usage.ts";

type Period = "today" | "week";
type Status = "all" | "high" | "limit" | "unreported";

// Kept while the app runs, as on the other list pages (D-81).
const QUERY = forSession("usage.query", "");
const PROVIDER = forSession("usage.provider", "all");
const STATUS = forSession<Status>("usage.status", "all");
const SORT = forSession<Sort>("usage.sort", "runs-out");
const LEFT = forSession("usage.left", false);
const PERIOD = forSession<Period>("usage.period", "week");

const TEAMS_SHOWN = 8;

// How much is left on each account and what runs out first (D-61). Read-only: accounts are set up
// on Providers, except Add account, which opens its dialog here.
export function UsageView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const departments = useApp((state) => state.departments);
  const identities = useIdentities();
  const statuses = useHarnessStatuses();
  const usersOf = useAccountUsers();
  const stops = useLimitStops();
  const spend = useSpend();
  const now = useMinute();
  const live = useLiveLimits();
  const [query, setQuery] = useKept(QUERY);
  const [tool, setTool] = useKept(PROVIDER);
  const [status, setStatus] = useKept(STATUS);
  const [sort, setSort] = useKept(SORT);
  const [showLeft, setShowLeft] = useKept(LEFT);
  const [period, setPeriod] = useKept(PERIOD);
  const [adding, setAdding] = useState(false);
  const [allTeams, setAllTeams] = useState(false);

  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const description = (harness: string) => harnesses.find((known) => known.harness === harness);
  const nameOf = (harness: string) => description(harness)?.name ?? harness;
  const reports = (harness: string) => description(harness)?.capabilities.usageLimits ?? false;
  const labelOf = (account: Account) => accountLabel(account, identities[account.id]);

  // An added account always shows; a default login once its provider is ready here, or once it
  // was used, so a signed-out one shows while providers never set up stay off this page.
  const inUse = accounts.filter(
    (account) =>
      account.folder !== undefined ||
      account.environment.kind === "wsl" ||
      statuses === undefined ||
      isReady(statuses[account.harness]) ||
      usersOf.has(account.id) ||
      limits[account.id] !== undefined,
  );
  useReadIdentities(inUse);
  const used = harnesses.filter((known) =>
    inUse.some((account) => account.harness === known.harness),
  );

  const needle = query.trim().toLowerCase();
  const shown = inUse.filter(
    (account) =>
      (tool === "all" || account.harness === tool) &&
      (needle === "" ||
        `${labelOf(account)} ${account.name} ${nameOf(account.harness)} ${identities[account.id]?.email ?? ""}`
          .toLowerCase()
          .includes(needle)),
  );

  const rows: LimitRow[] = shown
    .filter((account) => reports(account.harness))
    .flatMap((account): LimitRow[] => {
      const identity = identities[account.id];
      const base = {
        account,
        label: labelOf(account),
        harnessName: nameOf(account.harness),
        plan: identity?.plan === undefined ? undefined : planName(identity.plan),
        signedOut: identity?.signedIn === false || account.signedIn === false,
        users: usersOf.get(account.id) ?? [],
      };
      const windows = currentLimits(limits[account.id], now);
      if (base.signedOut || windows.length === 0)
        return [{ ...base, key: account.id, limit: undefined }];
      return windows.map((limit) => ({ ...base, key: `${account.id}/${limit.id}`, limit }));
    })
    .filter((row) => {
      const fraction = row.limit?.usedFraction ?? 0;
      if (status === "high") return fraction >= 0.9;
      if (status === "limit") return fraction >= 1;
      return status !== "unreported";
    });
  const unreported =
    status === "all" || status === "unreported"
      ? shown.filter((account) => !reports(account.harness))
      : [];

  // A banner only when something needs the user: a limit reached, or one that runs out before
  // it resets (owner: warn, never move agents for them).
  const alerts = inUse
    .filter((account) => reports(account.harness))
    .flatMap((account) => {
      const full = fullest(limits[account.id], now);
      if (full === undefined) return [];
      const at = full.usedFraction >= 1 ? undefined : runsOutAt(full, now);
      if (full.usedFraction < 1 && at === undefined) return [];
      return [{ account, limit: full, runsOut: at }];
    });

  const reportedAt = Math.max(
    0,
    ...inUse.map((account) => Date.parse(limits[account.id]?.reportedAt ?? "") || 0),
  );

  const periodRows =
    spend === undefined ? undefined : period === "today" ? spend.today : spend.week;
  const byTeam = useMemo(() => {
    const teams = new Map<
      string,
      { key: string; team: string; accountId: string; tasks: number; tokens: number }
    >();
    for (const row of periodRows ?? []) {
      const record = useApp.getState().agents[row.agentId];
      const team =
        record?.departmentId === undefined
          ? "Assistants"
          : (departments[record.departmentId]?.name ?? "A team");
      // By id: two departments may share a name.
      const key = `${record?.departmentId ?? "assistants"}/${row.accountId}`;
      const known = teams.get(key) ?? { key, team, accountId: row.accountId, tasks: 0, tokens: 0 };
      known.tasks += row.tasks;
      known.tokens += tokensOf([row]);
      teams.set(key, known);
    }
    const total = new Map<string, number>();
    for (const entry of teams.values()) {
      total.set(entry.accountId, (total.get(entry.accountId) ?? 0) + entry.tokens);
    }
    return [...teams.values()]
      .map((entry) => ({ ...entry, share: entry.tokens / (total.get(entry.accountId) || 1) }))
      .toSorted((a, b) => b.tokens - a.tokens);
  }, [periodRows, departments]);

  const nameOfAccount = (accountId: string) => {
    const account = accounts.find((known) => known.id === accountId);
    return account === undefined ? accountId : `${nameOf(account.harness)} · ${labelOf(account)}`;
  };
  const mine = (accountId: string, list: readonly AccountUsage[] | undefined) =>
    (list ?? []).filter((row) => row.accountId === accountId);

  return (
    <section className={page.page} aria-labelledby="usage-title">
      <div className={styles.column}>
        <PageHeader
          id="usage-title"
          title="Usage"
          lead="How much is left on each account, and what runs out first."
          actions={
            <>
              {reportedAt === 0 ? null : (
                <span className={styles.muted}>
                  Updated {ago(new Date(reportedAt).toISOString(), now)}
                </span>
              )}
              <Button variant="ghost" onClick={live.refresh} disabled={live.refreshing}>
                <RefreshCw
                  size={14}
                  className={live.refreshing ? styles.turning : undefined}
                  aria-hidden
                />
                {live.refreshing ? "Refreshing" : "Refresh"}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden />
                Add account
              </Button>
            </>
          }
        />

        {inUse.length === 0 && statuses !== undefined ? (
          <div className={styles.empty}>
            <p>No providers ready</p>
            <Button variant="primary" onClick={() => navigate({ name: "providers" })}>
              Providers
            </Button>
          </div>
        ) : (
          <>
            {alerts.length === 0 ? null : (
              <div className={styles.banners}>
                {alerts.map(({ account, limit, runsOut }) => {
                  const resetsAt =
                    limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
                  const name = `${nameOf(account.harness)} · ${labelOf(account)}`;
                  const users = usersOf.get(account.id) ?? [];
                  const stopped = stops.filter((stop) => stop.accountId === account.id).length;
                  const high = runsOut === undefined || limit.usedFraction >= 0.9;
                  return (
                    <div
                      key={account.id}
                      className={`${styles.banner} ${high ? styles.bannerHigh : ""}`}
                      role="status"
                    >
                      <span className={styles.bannerText}>
                        <strong>{name}</strong>{" "}
                        {runsOut === undefined
                          ? `is at its ${windowLabel(limit).toLowerCase()} limit`
                          : `runs out at ${clock(runsOut, now)}`}
                        {resetsAt === undefined
                          ? "."
                          : runsOut === undefined
                            ? `, resets ${clock(resetsAt, now)} (${inTime(resetsAt, now)}).`
                            : `, before the ${clock(resetsAt, now)} reset.`}
                        {stopped > 0
                          ? ` ${stopped === 1 ? "1 agent" : `${stopped} agents`} stopped.`
                          : users.length > 0
                            ? ` ${users.length === 1 ? "1 agent uses" : `${users.length} agents use`} it.`
                            : ""}
                      </span>
                      {stopped > 0 ? (
                        <Button onClick={() => navigate({ name: "needs-you" })}>
                          Open Needs you
                        </Button>
                      ) : users.length > 0 ? (
                        <AgentsCell users={users} label={name} asButton />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <UsagePauses />

            <div className={styles.filters}>
              <SearchBox value={query} onChange={setQuery} label="Search accounts" />
              <ChoiceMenu
                label="Provider"
                value={tool}
                choices={[
                  { value: "all", label: "All" },
                  ...used.map((known) => ({ value: known.harness, label: known.name })),
                ]}
                onChange={setTool}
              />
              <ChoiceMenu
                label="Status"
                value={status}
                choices={[
                  { value: "all", label: "All" },
                  { value: "high", label: "Over 90%" },
                  { value: "limit", label: "At limit" },
                  { value: "unreported", label: "Not reported" },
                ]}
                onChange={setStatus}
              />
              <span className={styles.grow} />
              <ChoiceMenu
                label="Sort"
                value={sort}
                choices={[
                  { value: "runs-out", label: "Runs out first" },
                  { value: "used", label: "Most used" },
                  { value: "resets", label: "Resets soonest" },
                  { value: "provider", label: "Provider" },
                ]}
                onChange={setSort}
              />
              <fieldset className={styles.segment}>
                <legend className="visually-hidden">Show</legend>
                <button type="button" aria-pressed={!showLeft} onClick={() => setShowLeft(false)}>
                  Used
                </button>
                <button type="button" aria-pressed={showLeft} onClick={() => setShowLeft(true)}>
                  Left
                </button>
              </fieldset>
            </div>

            {rows.length === 0 && unreported.length === 0 ? (
              <p className={styles.empty}>No accounts match.</p>
            ) : null}
            {rows.length === 0 ? null : (
              <LimitsTable rows={sortRows(rows, sort, now)} showLeft={showLeft} now={now} />
            )}

            {unreported.length === 0 ? null : (
              <section className={styles.unreported} aria-labelledby="unreported-title">
                <div className={page.sectionHead}>
                  <h2 id="unreported-title" className={page.sectionTitle}>
                    Not reported by the provider
                  </h2>
                  <span className={styles.muted}>
                    Token counts from runs. Cost is an estimate at API prices.
                  </span>
                </div>
                <div className={styles.table}>
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className={styles.number}>Today</th>
                        <th className={styles.number}>This week</th>
                        <th>Cost</th>
                        <th className={table.agentsCell}>Agents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unreported.map((account) => {
                        const harness = description(account.harness);
                        const week = mine(account.id, spend?.week);
                        const estimate = estimateOf(week);
                        const name = `${nameOf(account.harness)} · ${labelOf(account)}`;
                        return (
                          <tr key={account.id}>
                            <td>
                              <span className={table.accountCell}>
                                <ProviderLogo harness={account.harness} size="sm" />
                                <span className={table.accountName}>{name}</span>
                              </span>
                            </td>
                            <td className={styles.number}>
                              {compactCount(tokensOf(mine(account.id, spend?.today)))}
                            </td>
                            <td className={styles.number}>{compactCount(tokensOf(week))}</td>
                            <td>
                              <span className={styles.costCell}>
                                {estimate === undefined ? (
                                  <span className={styles.muted}>None</span>
                                ) : (
                                  estimateText(estimate)
                                )}
                                {harness?.usagePage === undefined ? null : (
                                  <a href={harness.usagePage} target="_blank" rel="noreferrer">
                                    {new URL(harness.usagePage).host}
                                  </a>
                                )}
                              </span>
                            </td>
                            <td className={table.agentsCell}>
                              <AgentsCell users={usersOf.get(account.id) ?? []} label={name} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        <section className={page.section} aria-labelledby="spend-title">
          <div className={page.sectionHead}>
            <h2 id="spend-title" className={page.sectionTitle}>
              Usage by team
            </h2>
            <ChoiceMenu
              label="Period"
              value={period}
              choices={[
                { value: "today", label: "Today" },
                { value: "week", label: "Last 7 days" },
              ]}
              onChange={setPeriod}
            />
          </div>
          {byTeam.length === 0 ? (
            <p className={styles.empty}>
              {periodRows === undefined ? "Loading" : "No agent work in this period."}
            </p>
          ) : (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Account</th>
                    <th>Share of account</th>
                    <th className={styles.number}>Tasks</th>
                    <th className={styles.number}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {(allTeams ? byTeam : byTeam.slice(0, TEAMS_SHOWN)).map((entry) => (
                    <tr key={entry.key}>
                      <td>
                        <span className={styles.team}>{entry.team}</span>
                      </td>
                      <td>{nameOfAccount(entry.accountId)}</td>
                      <td>
                        <div className={styles.share}>
                          <Meter usedFraction={entry.share} thin neutral />
                          {Math.round(entry.share * 100)}%
                        </div>
                      </td>
                      <td className={styles.number}>{entry.tasks}</td>
                      <td className={styles.number}>{compactCount(entry.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allTeams || byTeam.length <= TEAMS_SHOWN ? null : (
                <Button variant="ghost" onClick={() => setAllTeams(true)}>
                  Show all {byTeam.length}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
      {adding ? <AddAccountDialog onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
