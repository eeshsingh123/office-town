import type { Account } from "@office-town/contract";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { forSession, useKept } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ago, compactCount } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { isReady, useHarnessStatuses } from "../providers/providers.ts";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { tokensOf, useAccountUsers, useSpend } from "./accounts.tsx";
import { accountLabel, useIdentities, useReadIdentities } from "./identity.ts";
import { type LimitAlert, LimitAlerts } from "./LimitAlerts.tsx";
import { fullest, runsOutAt } from "./limits.ts";
import { Meter } from "./Meter.tsx";
import { ProviderUsage, providerFullest } from "./ProviderUsage.tsx";
import styles from "./Usage.module.css";
import { UsagePauses } from "./UsagePauses.tsx";
import { reloadAccounts, useLiveLimits, useMinute } from "./use-usage.ts";

type Period = "today" | "week";

// Kept while the app runs, as on the other list pages (D-81).
const LEFT = forSession("usage.left", false);
const PERIOD = forSession<Period>("usage.period", "week");

const TEAMS_SHOWN = 8;

// How much is left on each account, one card per provider (D-61). Accounts are set up on
// Providers, except Add account and Sign in, which open their dialog here.
export function UsageView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const departments = useApp((state) => state.departments);
  const identities = useIdentities();
  const statuses = useHarnessStatuses();
  const usersOf = useAccountUsers();
  const spend = useSpend();
  const now = useMinute();
  const live = useLiveLimits();
  const [showLeft, setShowLeft] = useKept(LEFT);
  const [period, setPeriod] = useKept(PERIOD);
  const [adding, setAdding] = useState(false);
  const [signingIn, setSigningIn] = useState<Account>();
  const [allTeams, setAllTeams] = useState(false);

  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
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
  // The provider nearest a limit first; those that share no limits after, by name.
  const providers = harnesses
    .map((description) => ({
      description,
      accounts: inUse.filter((account) => account.harness === description.harness),
    }))
    .filter((entry) => entry.accounts.length > 0)
    .map((entry) => ({
      ...entry,
      fullest: entry.description.capabilities.usageLimits
        ? providerFullest(entry.accounts, limits, now)
        : -2,
    }))
    .toSorted(
      (a, b) => b.fullest - a.fullest || a.description.name.localeCompare(b.description.name),
    );

  const alerts = providers
    .filter(({ description }) => description.capabilities.usageLimits)
    .flatMap(({ description, accounts: theirs }) =>
      theirs.flatMap((account): LimitAlert[] => {
        const full = fullest(limits[account.id], now);
        if (full === undefined) return [];
        const runsOut = full.usedFraction >= 1 ? undefined : runsOutAt(full, now);
        if (full.usedFraction < 1 && runsOut === undefined) return [];
        return [
          { account, label: labelOf(account), provider: description.name, limit: full, runsOut },
        ];
      }),
    );

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
              <fieldset className={styles.segment}>
                <legend className="visually-hidden">Show</legend>
                <button type="button" aria-pressed={!showLeft} onClick={() => setShowLeft(false)}>
                  Used
                </button>
                <button type="button" aria-pressed={showLeft} onClick={() => setShowLeft(true)}>
                  Left
                </button>
              </fieldset>
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
            <LimitAlerts alerts={alerts} now={now} />
            <UsagePauses />
            <div className={styles.providers}>
              {providers.map(({ description, accounts: theirs }) => (
                <ProviderUsage
                  key={description.harness}
                  description={description}
                  accounts={theirs}
                  limits={limits}
                  identities={identities}
                  usersOf={usersOf}
                  spend={spend}
                  showLeft={showLeft}
                  now={now}
                  onSignIn={setSigningIn}
                />
              ))}
            </div>
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
      {signingIn === undefined ? null : (
        <AddAccountDialog again={signingIn} onClose={() => setSigningIn(undefined)} />
      )}
    </section>
  );
}
