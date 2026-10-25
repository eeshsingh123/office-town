import type { Account } from "@office-town/contract";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { compactCount } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { isReady, useHarnessStatuses } from "../providers/providers.ts";
import { Meter } from "./AccountCard.tsx";
import { AccountGrid, tokensOf, useAccountUsers, useSpend } from "./AccountGrid.tsx";
import { clock, fullest, inTime, roomiest, windowLabel } from "./limits.ts";
import styles from "./Usage.module.css";
import { reloadAccounts, useLimitStops, useLiveLimits, useMinute } from "./use-usage.ts";

type Period = "today" | "week";

// Each account's plan limits, who uses it, and where the tokens went (D-61). Accounts are added
// on the Providers page (D-76).
export function UsageView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const departments = useApp((state) => state.departments);
  const statuses = useHarnessStatuses();
  const usersOf = useAccountUsers();
  const stops = useLimitStops();
  const spend = useSpend();
  const now = useMinute();
  const live = useLiveLimits();
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState("all");
  const [showLeft, setShowLeft] = useState(false);
  const [period, setPeriod] = useState<Period>("week");

  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const reports = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.capabilities.usageLimits ?? false;

  // An added account always shows; a default login once its AI app is ready here, or once it was
  // used, so a signed-out one can sign in again while apps never set up stay off this page.
  const inUse = accounts.filter(
    (account) =>
      account.folder !== undefined ||
      account.environment.kind === "wsl" ||
      statuses === undefined ||
      isReady(statuses[account.harness]) ||
      usersOf.has(account.id) ||
      limits[account.id] !== undefined,
  );
  const used = harnesses.filter((known) =>
    inUse.some((account) => account.harness === known.harness),
  );

  const withData = inUse.filter((account) => reports(account.harness));
  const fullness = (account: Account) => fullest(limits[account.id], now)?.usedFraction ?? 0;
  const atLimit = withData.filter((account) => fullness(account) >= 1);
  const near = withData.filter((account) => fullness(account) >= 0.9 && fullness(account) < 1);
  const best = roomiest(
    withData.filter((account) => fullness(account) < 1),
    limits,
  );

  const needle = query.trim().toLowerCase();
  const shown = inUse.filter(
    (account) =>
      (tool === "all" || account.harness === tool) &&
      (needle === "" ||
        `${account.name} ${nameOf(account.harness)}`.toLowerCase().includes(needle)),
  );
  const groups = used
    .map((harness) => ({
      harness,
      accounts: shown.filter((account) => account.harness === harness.harness),
    }))
    .filter((group) => group.accounts.length > 0);

  const rows = spend === undefined ? undefined : period === "today" ? spend.today : spend.week;
  const byTeam = useMemo(() => {
    const teams = new Map<
      string,
      { team: string; accountId: string; tasks: number; tokens: number }
    >();
    for (const row of rows ?? []) {
      const record = useApp.getState().agents[row.agentId];
      const team =
        record?.departmentId === undefined
          ? "Assistants"
          : (departments[record.departmentId]?.name ?? "A team");
      const key = `${team}/${row.accountId}`;
      const known = teams.get(key) ?? { team, accountId: row.accountId, tasks: 0, tokens: 0 };
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
  }, [rows, departments]);

  const accountLabel = (accountId: string) => {
    const account = accounts.find((known) => known.id === accountId);
    return account === undefined ? accountId : `${nameOf(account.harness)} · ${account.name}`;
  };

  return (
    <section className={page.page} aria-labelledby="usage-title">
      <div className={styles.column}>
        <div className={styles.top}>
          <header className={page.header}>
            <h1 id="usage-title" className={page.title}>
              Usage
            </h1>
            <p className={page.lead}>Plan limits for each account your agents use.</p>
          </header>
          <div className={styles.topActions}>
            <Button variant="ghost" onClick={live.refresh} disabled={live.refreshing}>
              <RefreshCw
                size={14}
                className={live.refreshing ? styles.turning : undefined}
                aria-hidden
              />
              {live.refreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button onClick={() => navigate({ name: "providers" })}>Manage accounts</Button>
          </div>
        </div>

        {atLimit.map((account) => {
          const full = fullest(limits[account.id], now);
          const resetsAt = full?.resetsAt === undefined ? undefined : Date.parse(full.resetsAt);
          const stopped = stops.filter((stop) => stop.accountId === account.id).length;
          return (
            <div key={account.id} className={styles.banner} role="status">
              <div className={styles.bannerText}>
                <strong>
                  {nameOf(account.harness)} · {account.name} is at its{" "}
                  {full === undefined ? "plan" : windowLabel(full).toLowerCase()} limit
                </strong>
                <span>
                  {stopped === 0
                    ? ""
                    : `${stopped === 1 ? "1 agent" : `${stopped} agents`} stopped. `}
                  {resetsAt === undefined
                    ? ""
                    : `Resets at ${clock(resetsAt, now)}, ${inTime(resetsAt, now)}.`}
                </span>
              </div>
              {stopped === 0 ? null : (
                <Button onClick={() => navigate({ name: "needs-you" })}>Open Needs you</Button>
              )}
            </div>
          );
        })}

        {withData.length === 0 ? null : (
          <div className={styles.glance}>
            <div className={`${styles.tile} ${atLimit.length > 0 ? styles.tileHigh : ""}`}>
              <span className={styles.tileNumber}>{atLimit.length}</span>
              <span className={styles.tileLabel}>at the limit</span>
            </div>
            <div className={`${styles.tile} ${near.length > 0 ? styles.tileHigh : ""}`}>
              <span className={styles.tileNumber}>{near.length}</span>
              <span className={styles.tileLabel}>over 90% used</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileNumber}>
                {withData.length - atLimit.length - near.length}
              </span>
              <span className={styles.tileLabel}>with room</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileName}>{best?.name ?? "None"}</span>
              <span className={styles.tileLabel}>
                {best === undefined ? "most room now" : `${nameOf(best.harness)} · most room now`}
              </span>
            </div>
          </div>
        )}

        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search accounts"
              aria-label="Search accounts"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ChoiceMenu
            label="Tool"
            value={tool}
            choices={[
              { value: "all", label: "All" },
              ...used.map((known) => ({ value: known.harness, label: known.name })),
            ]}
            onChange={setTool}
          />
          <ChoiceMenu
            label="Show"
            value={showLeft ? "left" : "used"}
            choices={[
              { value: "used", label: "Used" },
              { value: "left", label: "Left" },
            ]}
            onChange={(value) => setShowLeft(value === "left")}
          />
        </div>

        {groups.length === 0 ? <p className={styles.empty}>No accounts match.</p> : null}
        {groups.map(({ harness, accounts: list }) => (
          <section key={harness.harness} className={styles.tool} aria-label={harness.name}>
            <div className={styles.toolHead}>
              <h2 className={styles.toolName}>{harness.name}</h2>
              <span className={styles.muted}>
                {list.length === 1 ? "1 account" : `${list.length} accounts`}
              </span>
            </div>
            <AccountGrid accounts={list} spend={spend} showLeft={showLeft} />
          </section>
        ))}

        <section className={page.section} aria-labelledby="spend-title">
          <div className={page.sectionHead}>
            <h2 id="spend-title" className={page.sectionTitle}>
              Where it went
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
              {rows === undefined ? "Loading…" : "No agent work in this period."}
            </p>
          ) : (
            <div className={styles.table}>
              <table>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Account</th>
                    <th>Share of the account's tokens</th>
                    <th className={styles.number}>Tasks</th>
                    <th className={styles.number}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {byTeam.map((entry) => (
                    <tr key={`${entry.team}/${entry.accountId}`}>
                      <td>
                        <span className={styles.team}>{entry.team}</span>
                      </td>
                      <td>{accountLabel(entry.accountId)}</td>
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
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
