import type { Account, UsageLimit } from "@office-town/contract";
import { TriangleAlert, X } from "lucide-react";
import { navigate } from "../../store/app-store.ts";
import { forSession, useKept } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import { AgentsCell } from "./AgentsCell.tsx";
import { useAccountUsers } from "./accounts.tsx";
import styles from "./LimitAlerts.module.css";
import { clock, inTime, windowLabel } from "./limits.ts";
import { useLimitStops } from "./use-usage.ts";

export interface LimitAlert {
  account: Account;
  label: string;
  provider: string;
  limit: UsageLimit;
  // When it runs out at this pace; undefined once it is at its limit.
  runsOut: number | undefined;
}

// Dismissed until that window resets, for as long as the app runs.
const DISMISSED = forSession("usage.dismissed-alerts", new Set<string>());
const keyOf = ({ account, limit, runsOut }: LimitAlert) =>
  `${account.id}/${limit.id}/${limit.resetsAt ?? ""}/${runsOut === undefined ? "full" : "pace"}`;

// Only when an account is at a limit, or will reach one before it resets (D-61).
export function LimitAlerts({ alerts, now }: { alerts: readonly LimitAlert[]; now: number }) {
  const [dismissed, setDismissed] = useKept(DISMISSED);
  const usersOf = useAccountUsers();
  const stops = useLimitStops();
  const shown = alerts.filter((alert) => !dismissed.has(keyOf(alert)));
  if (shown.length === 0) return null;
  return (
    <div className={styles.alerts}>
      {shown.map((alert) => {
        const { account, label, provider, limit, runsOut } = alert;
        const window = windowLabel(limit).toLowerCase();
        const resetsAt = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
        const users = usersOf.get(account.id) ?? [];
        const stopped = stops.filter((stop) => stop.accountId === account.id).length;
        const reset =
          resetsAt === undefined
            ? undefined
            : runsOut === undefined
              ? `Resets ${clock(resetsAt, now)}, ${inTime(resetsAt, now)}.`
              : `Resets ${clock(resetsAt, now)}.`;
        const who =
          stopped > 0
            ? `${stopped === 1 ? "1 agent" : `${stopped} agents`} stopped.`
            : users.length > 0
              ? `${users.length === 1 ? "1 agent uses" : `${users.length} agents use`} it.`
              : undefined;
        return (
          <div
            key={keyOf(alert)}
            className={`${styles.alert} ${runsOut === undefined ? styles.full : ""}`}
            role="status"
          >
            <TriangleAlert size={16} className={styles.icon} aria-hidden />
            <div className={styles.text}>
              <span>
                <strong>{label}</strong> on {provider}{" "}
                {runsOut === undefined
                  ? `reached its ${window} limit.`
                  : `will reach its ${window} limit around ${clock(runsOut, now)} at this pace.`}
              </span>
              {reset === undefined && who === undefined ? null : (
                <span className={styles.note}>{[reset, who].filter(Boolean).join(" ")}</span>
              )}
            </div>
            {stopped > 0 ? (
              <Button onClick={() => navigate({ name: "needs-you" })}>Open Needs you</Button>
            ) : users.length > 0 ? (
              <AgentsCell users={users} label={`${provider} · ${label}`} asButton />
            ) : null}
            <Button
              variant="ghost"
              icon
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => setDismissed(new Set(dismissed).add(keyOf(alert)))}
            >
              <X size={16} aria-hidden />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
