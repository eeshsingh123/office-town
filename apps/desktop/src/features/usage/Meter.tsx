import { type Tone, toneOf } from "./limits.ts";
import styles from "./Usage.module.css";

const BAR_TONE: Record<Tone, string | undefined> = {
  calm: undefined,
  near: styles.barNear,
  high: styles.barHigh,
};

// Drawn only: the percentage is always written beside it. Its colour follows what is used.
export function Meter({
  usedFraction,
  showLeft = false,
  thin = false,
  neutral = false,
}: {
  usedFraction: number;
  // Fills by what is left, as the number beside it says.
  showLeft?: boolean;
  thin?: boolean;
  // A share, not a limit, so it never turns amber or red.
  neutral?: boolean;
}) {
  const shown = showLeft ? Math.max(0, 1 - usedFraction) : usedFraction;
  return (
    <div
      className={[styles.bar, !neutral && BAR_TONE[toneOf(usedFraction)], thin && styles.thin]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      <i style={{ width: `${Math.min(100, shown * 100)}%` }} />
    </div>
  );
}
