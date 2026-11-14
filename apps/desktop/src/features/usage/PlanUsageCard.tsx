import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { useAccountLabels } from "./identity.ts";
import { fullest, limitLine, runsOutAt, toneOf } from "./limits.ts";
import { Meter } from "./Meter.tsx";
import styles from "./Usage.module.css";
import { useLiveLimits, useMinute } from "./use-usage.ts";

const SHOWN = 5;

// Each account's fullest window, what runs out first on top; the whole picture is on Usage.
export function PlanUsageCard({ className = "" }: { className?: string | undefined }) {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const labelOf = useAccountLabels();
  const now = useMinute();
  useLiveLimits();
  const rows = accounts
    .flatMap((account) => {
      const window = fullest(limits[account.id], now);
      if (window === undefined) return [];
      const harness = harnesses.find((known) => known.harness === account.harness)?.name;
      const out = runsOutAt(window, now) ?? Number.POSITIVE_INFINITY;
      return [
        { account, window, out, name: `${harness ?? account.harness} · ${labelOf(account)}` },
      ];
    })
    .toSorted((a, b) => a.out - b.out || b.window.usedFraction - a.window.usedFraction);
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
      <div className={styles.planRows}>
        {rows.slice(0, SHOWN).map(({ account, window, name }) => {
          const tone = toneOf(window.usedFraction);
          return (
            <div key={account.id} className={styles.planRow}>
              <span className={styles.planName}>{name}</span>
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
                {limitLine(window, now)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
