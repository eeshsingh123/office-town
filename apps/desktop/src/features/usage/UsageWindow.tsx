import type { UsageLimit } from "@office-town/contract";
import { clock, percent, toneOf, windowLabel } from "./limits.ts";
import { Meter } from "./Meter.tsx";
import styles from "./UsageWindow.module.css";

// One limit window, the same on Usage and Home: how much is used, a meter, and when it resets.
export function UsageWindow({
  limit,
  now,
  showLeft = false,
  named = false,
}: {
  limit: UsageLimit;
  now: number;
  showLeft?: boolean;
  // Its name above the meter, where no column header names it.
  named?: boolean;
}) {
  const resetsAt = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
  const tone = toneOf(limit.usedFraction);
  const value =
    limit.usedFraction >= 1
      ? "At limit"
      : showLeft
        ? `${percent(Math.max(0, 1 - limit.usedFraction))} left`
        : `${percent(limit.usedFraction)} used`;
  return (
    <div className={styles.window}>
      <div className={styles.top}>
        {named ? <span className={styles.name}>{windowLabel(limit)}</span> : null}
        <strong className={tone === "calm" ? styles.value : `${styles.value} ${styles[tone]}`}>
          {value}
        </strong>
      </div>
      <Meter usedFraction={limit.usedFraction} showLeft={showLeft} thin />
      <span className={styles.reset}>
        {resetsAt !== undefined
          ? `Resets ${clock(resetsAt, now)}`
          : limit.usedFraction === 0
            ? "Not started"
            : "Reset time not shared"}
      </span>
    </div>
  );
}
