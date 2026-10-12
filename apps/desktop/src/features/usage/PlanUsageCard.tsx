import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { Meter } from "./AccountCard.tsx";
import { clock, fullest, percent, toneOf, windowLabel } from "./limits.ts";
import styles from "./Usage.module.css";
import { useLiveLimits, useMinute } from "./use-usage.ts";

const SHOWN = 5;

// Each account's fullest window, the fullest first; the whole picture is on Usage.
export function PlanUsageCard({ className = "" }: { className?: string | undefined }) {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const now = useMinute();
  useLiveLimits();
  const rows = accounts
    .flatMap((account) => {
      const window = fullest(limits[account.id], now);
      if (window === undefined) return [];
      const harness = harnesses.find((known) => known.harness === account.harness)?.name;
      return [{ account, window, name: `${harness ?? account.harness} · ${account.name}` }];
    })
    .toSorted((a, b) => b.window.usedFraction - a.window.usedFraction);
  if (rows.length === 0) return null;
  return (
    <section className={`${className} ${styles.planCard}`} aria-labelledby="plan-usage-title">
      <div className={styles.planHead}>
        <h2 id="plan-usage-title" className={styles.toolName}>
          Plan usage
        </h2>
        <Button variant="ghost" onClick={() => navigate({ name: "usage" })}>
          Open Usage
        </Button>
      </div>
      <div className={styles.planRows}>
        {rows.slice(0, SHOWN).map(({ account, window, name }) => {
          const tone = toneOf(window.usedFraction);
          const full = window.usedFraction >= 1 && window.resetsAt !== undefined;
          return (
            <div key={account.id} className={styles.planRow}>
              <span className={styles.planName}>
                {name} <span>· {windowLabel(window).toLowerCase()}</span>
              </span>
              <Meter usedFraction={window.usedFraction} thin />
              <span
                className={[
                  styles.planValue,
                  tone === "high" && styles.planValueHigh,
                  tone === "near" && styles.planValueNear,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {full && window.resetsAt !== undefined
                  ? `Back ${clock(Date.parse(window.resetsAt), now)}`
                  : percent(window.usedFraction)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
