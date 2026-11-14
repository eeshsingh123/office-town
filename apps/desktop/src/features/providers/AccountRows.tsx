import type { Account, HarnessDescription } from "@office-town/contract";
import { navigate, useApp } from "../../store/app-store.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { compactCount, environmentName } from "../../ui/format.ts";
import { Pill } from "../../ui/Pill.tsx";
import { type Spend, tokensOf, useAccountMenu, useAccountUsers } from "../usage/accounts.tsx";
import { accountLabel, planName, useIdentities, useReadIdentities } from "../usage/identity.ts";
import { fullest, limitLine, toneOf } from "../usage/limits.ts";
import { useMinute } from "../usage/use-usage.ts";
import styles from "./Providers.module.css";

const agentsText = (count: number) =>
  count === 0 ? "no agents" : count === 1 ? "1 agent" : `${count} agents`;

// One row per account under its provider: who it is, where it runs if not here, who uses it, and
// one limit line that opens Usage. Meters live on Usage only (a5-1).
export function AccountRows({
  description,
  accounts,
  spend,
}: {
  description: HarnessDescription;
  accounts: readonly Account[];
  spend: Spend | undefined;
}) {
  const limits = useApp((state) => state.limits);
  const identities = useIdentities();
  const usersOf = useAccountUsers();
  const { menu, dialogs } = useAccountMenu();
  const now = useMinute();
  useReadIdentities(accounts);
  if (accounts.length === 0) return null;
  return (
    <>
      <ul className={styles.accounts} aria-label={`${description.name} accounts`}>
        {accounts.map((account) => {
          const identity = identities[account.id];
          const label = accountLabel(account, identity);
          const plan = identity?.plan === undefined ? undefined : planName(identity.plan);
          const users = usersOf.get(account.id)?.length ?? 0;
          const full = fullest(limits[account.id], now);
          const signedOut = identity?.signedIn === false || account.signedIn === false;
          const week = tokensOf((spend?.week ?? []).filter((row) => row.accountId === account.id));
          const content = menu(account);
          return (
            <li key={account.id} className={styles.account}>
              <span className={styles.accountText}>
                <span className={styles.accountName}>
                  {label}
                  {account.environment.kind === "wsl" ? (
                    <span className={styles.envTag}>{environmentName(account.environment)}</span>
                  ) : null}
                </span>
                <span className={styles.rowSub}>
                  {[plan, agentsText(users)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {signedOut ? (
                <Pill tone="warn">Not signed in</Pill>
              ) : description.capabilities.usageLimits ? (
                full === undefined ? (
                  <span className={styles.muted}>No reading yet</span>
                ) : (
                  <button
                    type="button"
                    className={`${styles.limit} ${toneOf(full.usedFraction) === "high" ? styles.limitHigh : ""}`}
                    onClick={() => navigate({ name: "usage" })}
                  >
                    {limitLine(full, now)}
                  </button>
                )
              ) : (
                <span className={styles.muted}>
                  No limits shared
                  {spend === undefined ? "" : ` · ${compactCount(week)} tokens this week`}
                </span>
              )}
              <span className={styles.accountMenu}>
                {content === undefined ? null : (
                  <MoreMenu label={`More for ${label}`} menu={() => content} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {dialogs}
    </>
  );
}
