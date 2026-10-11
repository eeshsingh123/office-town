import type { Account, AccountUsage } from "@office-town/contract";
import { Plus, Search } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import dialog from "../../ui/Dialog.module.css";
import { compactCount } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { AccountCard, Meter } from "./AccountCard.tsx";
import { AddAccountDialog } from "./AddAccountDialog.tsx";
import { clock, fullest, inTime, roomiest, sessionAccountId, windowLabel } from "./limits.ts";
import styles from "./Usage.module.css";
import { reloadAccounts, useLimitStops, useMinute } from "./use-usage.ts";

const DAY_MS = 24 * 3600_000;
const startOfToday = () => new Date(new Date().toDateString()).toISOString();
const weekAgo = () => new Date(Date.now() - 7 * DAY_MS).toISOString();

type Period = "today" | "week";

const tokensOf = (rows: readonly AccountUsage[]) =>
  rows.reduce((sum, row) => sum + row.inputTokens - row.cachedInputTokens + row.outputTokens, 0);

// The turns of today and of the last seven days, read when the page opens.
function useSpend() {
  const [spend, setSpend] = useState<{ today: AccountUsage[]; week: AccountUsage[] }>();
  useEffect(() => {
    let current = true;
    Promise.all([api.listAccountUsage(startOfToday()), api.listAccountUsage(weekAgo())])
      .then(([today, week]) => current && setSpend({ today, week }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return spend;
}

function RenameDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await api.renameAccount(account.id, name.trim());
      await reloadAccounts();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content}>
          <Dialog.Title className={dialog.title}>Rename account</Dialog.Title>
          <Dialog.Description className="visually-hidden">
            A new name for this account.
          </Dialog.Description>
          <label className={dialog.label}>
            Name
            <input
              className={dialog.input}
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {error === undefined ? null : (
            <p className={dialog.error} role="alert">
              {error}
            </p>
          )}
          <div className={dialog.actions}>
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" disabled={name.trim() === ""} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const remove = async () => {
    await api.deleteAccount(account.id);
    await reloadAccounts();
    onClose();
  };
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>Remove {account.name}?</AlertDialog.Title>
          <AlertDialog.Description className={dialog.description}>
            Its sign-in is deleted from this computer. Agents that used it switch to Automatic.
          </AlertDialog.Description>
          <div className={dialog.actions}>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant="primary" onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type Open =
  | { kind: "add" }
  | { kind: "again"; account: Account }
  | { kind: "rename"; account: Account }
  | { kind: "remove"; account: Account };

// Each account's plan limits, who uses it, and where the tokens went (D-61).
export function UsageView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const departments = useApp((state) => state.departments);
  const traces = useApp((state) => state.traces);
  const agents = useAgents();
  const stops = useLimitStops();
  const spend = useSpend();
  const now = useMinute();
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState("all");
  const [showLeft, setShowLeft] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [open, setOpen] = useState<Open>();

  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const reports = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.capabilities.usageLimits ?? false;

  // An agent counts for the account it picked, or else the one its last session ran on.
  const usersOf = useMemo(() => {
    const users = new Map<string, Agent[]>();
    for (const agent of agents) {
      const id = agent.record.settings.accountId ?? sessionAccountId(agent.latest.options);
      users.set(id, [...(users.get(id) ?? []), agent]);
    }
    return users;
  }, [agents]);

  const withData = accounts.filter((account) => reports(account.harness));
  const fullness = (account: Account) => fullest(limits[account.id], now)?.usedFraction ?? 0;
  const atLimit = withData.filter((account) => fullness(account) >= 1);
  const near = withData.filter((account) => fullness(account) >= 0.9 && fullness(account) < 1);
  const best = roomiest(
    withData.filter((account) => fullness(account) < 1),
    limits,
  );

  const needle = query.trim().toLowerCase();
  const shown = accounts.filter(
    (account) =>
      (tool === "all" || account.harness === tool) &&
      (needle === "" ||
        `${account.name} ${nameOf(account.harness)}`.toLowerCase().includes(needle)),
  );
  const groups = harnesses
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
          <Button variant="primary" onClick={() => setOpen({ kind: "add" })}>
            <Plus size={14} aria-hidden />
            Add account
          </Button>
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
              ...harnesses.map((known) => ({ value: known.harness, label: known.name })),
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
            <div className={styles.cards}>
              {list.map((account) => {
                const users = usersOf.get(account.id) ?? [];
                const working = users.filter((agent) => {
                  const state = stateOf(agent, traces, false);
                  return state === "working" || state === "starting";
                }).length;
                const mine = (rows: readonly AccountUsage[] | undefined) =>
                  tokensOf((rows ?? []).filter((row) => row.accountId === account.id));
                return (
                  <AccountCard
                    key={account.id}
                    account={account}
                    harnessName={harness.name}
                    reportsLimits={harness.capabilities.usageLimits}
                    limits={limits[account.id]}
                    users={users}
                    working={working}
                    tokens={{ today: mine(spend?.today), week: mine(spend?.week) }}
                    showLeft={showLeft}
                    now={now}
                    onRename={(chosen) => setOpen({ kind: "rename", account: chosen })}
                    onSignIn={(chosen) => setOpen({ kind: "again", account: chosen })}
                    onRemove={(chosen) => setOpen({ kind: "remove", account: chosen })}
                  />
                );
              })}
            </div>
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

      {open?.kind === "add" ? <AddAccountDialog onClose={() => setOpen(undefined)} /> : null}
      {open?.kind === "again" ? (
        <AddAccountDialog again={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === "rename" ? (
        <RenameDialog account={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
      {open?.kind === "remove" ? (
        <RemoveDialog account={open.account} onClose={() => setOpen(undefined)} />
      ) : null}
    </section>
  );
}
