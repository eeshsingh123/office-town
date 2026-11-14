import type { ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillTone = "ok" | "warn" | "bad" | "muted";

// One status chip for providers and accounts: Ready, Not signed in, Not installed, At limit,
// Over 90%, Not reported. Sentence case, shown once per screen.
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}
