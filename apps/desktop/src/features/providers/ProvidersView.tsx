import type { Account, HarnessDescription, HarnessStatus } from "@office-town/contract";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { compactCount } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { Meter } from "../usage/AccountCard.tsx";
import { type Spend, tokensOf, useSpend } from "../usage/AccountGrid.tsx";
import { AddAccountDialog } from "../usage/AddAccountDialog.tsx";
import { fullest, percent, windowLabel } from "../usage/limits.ts";
import { reloadAccounts, useLiveLimits, useMinute } from "../usage/use-usage.ts";
import { InstallSheet } from "./InstallSheet.tsx";
import { ProviderCard } from "./ProviderCard.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { defaultLogin, isReady, useHarnessStatuses } from "./providers.ts";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function subOf(status: HarnessStatus, accounts: number) {
  if (status.signedIn === false) return "Installed · not signed in";
  const version = status.version ? ` · version ${status.version}` : "";
  return `${plural(accounts, "account")}${version}`;
}

// The fullest window across the app's accounts, or its tokens this week where it reports none.
function Side(props: { description: HarnessDescription; accounts: Account[]; spend?: Spend }) {
  const limits = useApp((state) => state.limits);
  const now = useMinute();
  const { description, accounts, spend } = props;
  if (description.capabilities.usageLimits) {
    const windows = accounts.flatMap((account) => {
      const full = fullest(limits[account.id], now);
      return full === undefined ? [] : [full];
    });
    const top = windows.toSorted((a, b) => b.usedFraction - a.usedFraction)[0];
    if (top === undefined) return <span className={styles.rowSpacer} />;
    return (
      <span className={styles.rowSide}>
        <span className={styles.rowSideLine}>
          <span>
            {windowLabel(top)}
            {accounts.length > 1 ? ", fullest account" : ""}
          </span>
          <span>{percent(top.usedFraction)}</span>
        </span>
        <Meter usedFraction={top.usedFraction} thin />
      </span>
    );
  }
  const ids = new Set(accounts.map((account) => account.id));
  const week = tokensOf((spend?.week ?? []).filter((row) => ids.has(row.accountId)));
  return (
    <span className={styles.rowSide}>
      {spend === undefined ? "" : `${compactCount(week)} tokens this week`}
    </span>
  );
}

type Sheet = { kind: "install"; harness: string } | { kind: "sign-in"; account: Account };

// The AI apps agents run on: the ones here with their accounts, and the ones to get (D-76).
export function ProvidersView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const statuses = useHarnessStatuses({ recheckOnFocus: true });
  const spend = useSpend();
  useLiveLimits();
  const [sheet, setSheet] = useState<Sheet>();
  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const statusOf = (harness: string) => statuses?.[harness];
  const installed = harnesses.filter((known) => statusOf(known.harness)?.installed);
  const missing = harnesses.filter((known) => statusOf(known.harness)?.installed === false);
  const accountsOf = (harness: string) =>
    accounts.filter(
      (account) => account.harness === harness && account.environment.kind === "native",
    );
  const signIn = (harness: string) => {
    const account = defaultLogin(accounts, harness);
    setSheet(account === undefined ? undefined : { kind: "sign-in", account });
  };

  return (
    <section className={page.page} aria-labelledby="providers-title">
      <div className={styles.column}>
        <header className={page.header}>
          <h1 id="providers-title" className={page.title}>
            Providers
          </h1>
          <p className={page.lead}>The AI apps your agents run on, and your accounts on them.</p>
        </header>

        {statuses === undefined ? (
          <p className={styles.muted}>Checking this computer…</p>
        ) : (
          <>
            <div className={page.section}>
              <div className={page.sectionHead}>
                <h2 className={page.sectionTitle}>
                  Your AI apps <span className={styles.count}>{installed.length}</span>
                </h2>
              </div>
              {installed.length === 0 ? (
                <p className={styles.muted}>None yet. Install one below to get started.</p>
              ) : (
                <ul className={styles.list} aria-label="Your AI apps">
                  {installed.map((description) => {
                    const status = statusOf(description.harness);
                    if (status === undefined) return null;
                    const mine = accountsOf(description.harness);
                    const needsSignIn = !isReady(status);
                    return (
                      <li key={description.harness} className={styles.item}>
                        <button
                          type="button"
                          className={styles.row}
                          onClick={() =>
                            navigate({ name: "provider", harness: description.harness })
                          }
                        >
                          <ProviderLogo harness={description.harness} />
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>{description.name}</span>
                            <span className={styles.rowSub}>{subOf(status, mine.length)}</span>
                          </span>
                          {needsSignIn ? (
                            <span className={styles.rowSpacer} />
                          ) : (
                            <Side
                              description={description}
                              accounts={mine}
                              {...(spend ? { spend } : {})}
                            />
                          )}
                          <ChevronRight size={16} className={styles.go} aria-hidden />
                        </button>
                        {needsSignIn ? (
                          <span className={styles.rowAction}>
                            <Button variant="primary" onClick={() => signIn(description.harness)}>
                              Sign in
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {missing.length === 0 ? null : (
              <div className={page.section}>
                <div className={page.sectionHead}>
                  <h2 className={page.sectionTitle}>
                    Get more <span className={styles.count}>{missing.length}</span>
                  </h2>
                </div>
                <ul className={styles.grid} aria-label="AI apps to install">
                  {missing.map((description) => (
                    <ProviderCard
                      key={description.harness}
                      description={description}
                      status={statusOf(description.harness)}
                      onInstall={() => setSheet({ kind: "install", harness: description.harness })}
                      onSignIn={() => signIn(description.harness)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {sheet?.kind === "install" ? (
        <InstallSheet
          harness={sheet.harness}
          onSignIn={() => signIn(sheet.harness)}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet?.kind === "sign-in" ? (
        <AddAccountDialog again={sheet.account} onClose={() => setSheet(undefined)} />
      ) : null}
    </section>
  );
}
