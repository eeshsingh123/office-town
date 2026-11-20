import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { accountLabel, planName, useIdentities, useReadIdentities } from "./identity.ts";
import { fullest, orderedLimits } from "./limits.ts";
import styles from "./Usage.module.css";
import { UsageWindow } from "./UsageWindow.tsx";
import { useLiveLimits, useMinute } from "./use-usage.ts";

const SHOWN = 4;

// The most used accounts, each with its windows as on Usage; the rest are on Usage.
export function PlanUsageCard({ className = "" }: { className?: string | undefined }) {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const identities = useIdentities();
  const now = useMinute();
  useLiveLimits();
  const rows = accounts
    .flatMap((account) => {
      const top = fullest(limits[account.id], now);
      return top === undefined ? [] : [{ account, top: top.usedFraction }];
    })
    .toSorted((a, b) => b.top - a.top);
  const shown = rows.slice(0, SHOWN).map(({ account }) => account);
  useReadIdentities(shown);
  if (rows.length === 0) return null;
  const more = rows.length - SHOWN;
  return (
    <section className={`${className} ${styles.planCard}`} aria-labelledby="plan-usage-title">
      <div className={styles.planHead}>
        <h2 id="plan-usage-title" className={styles.toolName}>
          Plan usage
        </h2>
        <Button variant="ghost" onClick={() => navigate({ name: "usage" })}>
          {more > 0 ? `+${more} more on Usage` : "Usage"}
        </Button>
      </div>
      <ul className={styles.planCards}>
        {shown.map((account) => {
          const identity = identities[account.id];
          const provider =
            harnesses.find((known) => known.harness === account.harness)?.name ?? account.harness;
          const label = accountLabel(account, identity);
          return (
            <li key={account.id} className={styles.planAccount}>
              <div className={styles.planWho}>
                <ProviderLogo harness={account.harness} size="sm" />
                <span className={styles.planText}>
                  <span className={styles.planName} title={label}>
                    {label}
                  </span>
                  <span className={styles.muted}>
                    {[provider, identity?.plan === undefined ? undefined : planName(identity.plan)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </div>
              {orderedLimits(limits[account.id], now).map((limit) => (
                <UsageWindow key={limit.id} limit={limit} now={now} named />
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
