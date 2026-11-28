import type {
  Account,
  AccountLimits,
  AccountStatus,
  HarnessDescription,
  UsageLimit,
} from "@office-town/contract";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Agent } from "../../store/agents.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ClearFilters } from "../../ui/ClearFilters.tsx";
import { NoMatch } from "../../ui/EmptyState.tsx";
import { compactCount, environmentName } from "../../ui/format.ts";
import { Pill } from "../../ui/Pill.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { AgentsCell } from "./AgentsCell.tsx";
import { estimateOf, estimateText, type Spend, tokensOf } from "./accounts.tsx";
import { accountLabel, planName } from "./identity.ts";
import { byWindow, orderedLimits, windowLabel } from "./limits.ts";
import styles from "./ProviderUsage.module.css";
import { UsageWindow } from "./UsageWindow.tsx";

type Sort = "used" | "resets" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "used", label: "Most used" },
  { value: "resets", label: "Resets soonest" },
  { value: "name", label: "Name" },
];

// Search and Sort only once a provider has more accounts than fit at a glance.
const FILTERS_FROM = 5;

interface Row {
  account: Account;
  label: string;
  plan: string | undefined;
  signedOut: boolean;
  users: readonly Agent[];
  windows: UsageLimit[];
}

const fullestOf = (row: Row) =>
  row.signedOut ? -1 : Math.max(-0.5, ...row.windows.map((limit) => limit.usedFraction));
const resetOf = (row: Row) =>
  Math.min(
    Number.POSITIVE_INFINITY,
    ...row.windows.flatMap((limit) =>
      limit.resetsAt === undefined ? [] : [Date.parse(limit.resetsAt)],
    ),
  );

function sortRows(rows: readonly Row[], sort: Sort): Row[] {
  return rows.toSorted((a, b) => {
    if (sort === "resets") return resetOf(a) - resetOf(b) || a.label.localeCompare(b.label);
    if (sort === "used") return fullestOf(b) - fullestOf(a) || a.label.localeCompare(b.label);
    return a.label.localeCompare(b.label);
  });
}

// The fullest window of a provider's accounts, so the one nearest a limit comes first.
export function providerFullest(
  accounts: readonly Account[],
  limits: Record<string, AccountLimits>,
  now: number,
): number {
  return Math.max(
    -1,
    ...accounts.flatMap((account) =>
      orderedLimits(limits[account.id], now).map((limit) => limit.usedFraction),
    ),
  );
}

interface ProviderUsageProps {
  description: HarnessDescription;
  accounts: readonly Account[];
  limits: Record<string, AccountLimits>;
  identities: Record<string, AccountStatus>;
  usersOf: Map<string, Agent[]>;
  spend: Spend | undefined;
  showLeft: boolean;
  now: number;
  onSignIn: (account: Account) => void;
}

// One provider's accounts, one row each, its windows side by side under one header (owner,
// 2026-11-20: one account is never split over two rows).
export function ProviderUsage(props: ProviderUsageProps) {
  const { description, accounts, limits, identities, usersOf, spend, showLeft, now } = props;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("used");
  const reports = description.capabilities.usageLimits;
  const many = accounts.length >= FILTERS_FROM;

  const all: Row[] = accounts.map((account) => {
    const identity = identities[account.id];
    return {
      account,
      label: accountLabel(account, identity),
      plan: identity?.plan === undefined ? undefined : planName(identity.plan),
      signedOut: identity?.signedIn === false || account.signedIn === false,
      users: usersOf.get(account.id) ?? [],
      windows: reports ? orderedLimits(limits[account.id], now) : [],
    };
  });
  const needle = query.trim().toLowerCase();
  const rows = sortRows(
    all.filter(
      (row) =>
        needle === "" ||
        `${row.label} ${row.account.name} ${identities[row.account.id]?.email ?? ""}`
          .toLowerCase()
          .includes(needle),
    ),
    sort,
  );
  // One column per window any account reports, shortest first.
  const columns = [
    ...new Set(
      all
        .flatMap((row) => row.windows)
        .toSorted(byWindow)
        .map(windowLabel),
    ),
  ];
  const span = (reports ? Math.max(1, columns.length) : 3) + 1;
  const usage = description.usagePage;
  const sub = [
    accounts.length === 1 ? "1 account" : `${accounts.length} accounts`,
    reports ? undefined : "Doesn't share its limits",
  ].filter(Boolean);
  const mine = (list: Spend["week"] | undefined, accountId: string) =>
    (list ?? []).filter((row) => row.accountId === accountId);

  return (
    <section className={styles.card} aria-labelledby={`usage-${description.harness}`}>
      <header className={styles.head}>
        <ProviderLogo harness={description.harness} />
        <div className={styles.headText}>
          <h2 id={`usage-${description.harness}`} className={styles.name}>
            {description.name}
          </h2>
          <span className={styles.sub}>
            {sub.join(" · ")}
            {usage === undefined ? null : (
              <a className={styles.link} href={usage} target="_blank" rel="noreferrer">
                Usage on {new URL(usage).host}
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </span>
        </div>
        {many ? (
          <div className={styles.tools}>
            <ClearFilters
              shown={query !== "" || sort !== "used"}
              onClear={() => {
                setQuery("");
                setSort("used");
              }}
            />
            <SearchBox
              value={query}
              onChange={setQuery}
              label={`Search ${description.name} accounts`}
            />
            <ChoiceMenu label="Sort" value={sort} choices={SORTS} onChange={setSort} />
          </div>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <NoMatch title="No accounts match these filters" size="panel" />
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.accountHead}>Account</th>
                {reports ? (
                  columns.length === 0 ? (
                    <th>Limits</th>
                  ) : (
                    columns.map((column) => <th key={column}>{column}</th>)
                  )
                ) : (
                  <>
                    <th>Tokens this week</th>
                    <th>Tokens today</th>
                    <th>At API prices</th>
                  </>
                )}
                <th className={styles.agentsHead}>Agents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { account } = row;
                const week = mine(spend?.week, account.id);
                const estimate = estimateOf(week);
                return (
                  <tr key={account.id}>
                    <td>
                      <span className={styles.account}>
                        <span className={styles.accountName}>
                          {row.label}
                          {account.environment.kind === "wsl" ? (
                            <span className={styles.envTag}>
                              {environmentName(account.environment)}
                            </span>
                          ) : null}
                        </span>
                        {row.plan === undefined ? null : (
                          <span className={styles.plan}>{row.plan}</span>
                        )}
                      </span>
                    </td>
                    {row.signedOut ? (
                      <td colSpan={span - 1}>
                        <span className={styles.signedOut}>
                          <Pill tone="warn">Not signed in</Pill>
                          <Button onClick={() => props.onSignIn(account)}>Sign in</Button>
                        </span>
                      </td>
                    ) : !reports ? (
                      <>
                        <td className={styles.number}>
                          {spend === undefined ? "" : compactCount(tokensOf(week))}
                        </td>
                        <td className={styles.number}>
                          {spend === undefined
                            ? ""
                            : compactCount(tokensOf(mine(spend.today, account.id)))}
                        </td>
                        <td className={styles.quiet}>
                          {estimate === undefined ? "None" : estimateText(estimate)}
                        </td>
                      </>
                    ) : row.windows.length === 0 ? (
                      <td colSpan={span - 1} className={styles.quiet}>
                        Shows after an agent's first reply
                      </td>
                    ) : (
                      columns.map((column) => {
                        const limit = row.windows.find((one) => windowLabel(one) === column);
                        return (
                          <td key={column} className={styles.windowCell}>
                            {limit === undefined ? (
                              <span className={styles.quiet}>Not shared</span>
                            ) : (
                              <UsageWindow limit={limit} now={now} showLeft={showLeft} />
                            )}
                          </td>
                        );
                      })
                    )}
                    <td>
                      <AgentsCell users={row.users} label={`${description.name} · ${row.label}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
