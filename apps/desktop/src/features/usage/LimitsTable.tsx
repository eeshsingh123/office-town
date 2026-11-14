import type { Account, UsageLimit } from "@office-town/contract";
import type { Agent } from "../../store/agents.ts";
import { environmentName } from "../../ui/format.ts";
import { Pill } from "../../ui/Pill.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { AgentsCell } from "./AgentsCell.tsx";
import table from "./LimitsTable.module.css";
import { clock, inTime, percent, runsOutAt, toneOf, windowLabel } from "./limits.ts";
import { Meter } from "./Meter.tsx";
import styles from "./Usage.module.css";

// One window of one account; an account with no reading yet, or signed out, has one row too.
export interface LimitRow {
  key: string;
  account: Account;
  label: string;
  harnessName: string;
  plan: string | undefined;
  limit: UsageLimit | undefined;
  signedOut: boolean;
  users: readonly Agent[];
}

export type Sort = "runs-out" | "used" | "resets" | "provider";

const WINDOW_ORDER = ["five_hour", "seven_day"];
const windowOrder = (limit: UsageLimit | undefined) => {
  const at = WINDOW_ORDER.indexOf(limit?.id ?? "");
  return at === -1 ? WINDOW_ORDER.length : at;
};
const resetOf = (limit: UsageLimit | undefined) =>
  limit?.resetsAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(limit.resetsAt);

export function sortRows(rows: readonly LimitRow[], sort: Sort, now: number): LimitRow[] {
  const used = (row: LimitRow) => row.limit?.usedFraction ?? -1;
  const runsOut = (row: LimitRow) =>
    row.limit === undefined
      ? Number.POSITIVE_INFINITY
      : (runsOutAt(row.limit, now) ?? Number.POSITIVE_INFINITY);
  const byProvider = (a: LimitRow, b: LimitRow) =>
    a.harnessName.localeCompare(b.harnessName) ||
    a.label.localeCompare(b.label) ||
    windowOrder(a.limit) - windowOrder(b.limit);
  return rows.toSorted((a, b) => {
    if (sort === "provider") return byProvider(a, b);
    if (sort === "resets") return resetOf(a.limit) - resetOf(b.limit) || used(b) - used(a);
    if (sort === "runs-out") {
      const first = runsOut(a) - runsOut(b);
      if (first !== 0 && !Number.isNaN(first)) return first;
    }
    return used(b) - used(a) || byProvider(a, b);
  });
}

function RunsOut({ limit, now }: { limit: UsageLimit; now: number }) {
  if (limit.usedFraction >= 1) return <span className={table.outHigh}>At limit</span>;
  const at = runsOutAt(limit, now);
  if (at === undefined) return <span className={styles.muted}>Lasts</span>;
  const tone = toneOf(limit.usedFraction);
  return (
    <span className={tone === "high" ? table.outHigh : tone === "near" ? table.outNear : table.out}>
      {clock(at, now)}
    </span>
  );
}

function Row({ row, showLeft, now }: { row: LimitRow; showLeft: boolean; now: number }) {
  const { account, limit } = row;
  const resetsAt = limit?.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
  const value =
    limit === undefined
      ? undefined
      : showLeft
        ? percent(Math.max(0, 1 - limit.usedFraction))
        : percent(limit.usedFraction);
  return (
    <tr>
      <td>
        <span className={table.accountCell}>
          <ProviderLogo harness={account.harness} size="sm" />
          <span className={table.accountText}>
            <span className={table.accountName}>
              {row.label}
              {account.environment.kind === "wsl" ? (
                <span className={table.envTag}>{environmentName(account.environment)}</span>
              ) : null}
            </span>
            <span className={table.accountSub}>
              {[row.harnessName, row.plan].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>
      </td>
      {row.signedOut ? (
        <td colSpan={4}>
          <Pill tone="warn">Not signed in</Pill>
        </td>
      ) : limit === undefined ? (
        <td colSpan={4} className={styles.muted}>
          Shows after an agent's first reply
        </td>
      ) : (
        <>
          <td className={table.windowCell}>{windowLabel(limit)}</td>
          <td>
            <span className={table.usedCell}>
              <Meter usedFraction={limit.usedFraction} showLeft={showLeft} thin />
              <strong>{value}</strong>
            </span>
          </td>
          <td className={styles.resetCell}>
            {resetsAt === undefined ? (
              <span className={styles.muted}>Not shared</span>
            ) : (
              <>
                {clock(resetsAt, now)}{" "}
                <span className={styles.muted}>· {inTime(resetsAt, now)}</span>
              </>
            )}
            <span className={table.outInline}>
              <RunsOut limit={limit} now={now} />
            </span>
          </td>
          <td className={table.outCell}>
            <RunsOut limit={limit} now={now} />
          </td>
        </>
      )}
      <td className={table.agentsCell}>
        <AgentsCell users={row.users} label={`${row.harnessName} · ${row.label}`} />
      </td>
    </tr>
  );
}

// One row per account window, so every account's limits compare at a glance (a5-3).
export function LimitsTable(props: { rows: readonly LimitRow[]; showLeft: boolean; now: number }) {
  return (
    <div className={table.limits}>
      <table aria-label="Limits">
        <thead>
          <tr>
            <th>Account</th>
            <th className={table.windowCell}>Window</th>
            <th className={table.usedHead}>{props.showLeft ? "Left" : "Used"}</th>
            <th className={styles.resetCell}>Resets</th>
            <th className={table.outCell}>Runs out</th>
            <th className={table.agentsCell}>Agents</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <Row key={row.key} row={row} showLeft={props.showLeft} now={props.now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
