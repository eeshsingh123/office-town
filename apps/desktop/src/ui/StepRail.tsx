import { Check } from "lucide-react";
import type { ReactNode } from "react";
import page from "./Page.module.css";
import styles from "./Steps.module.css";

interface StepRailProps {
  back: { label: string; onClick: () => void };
  title: string;
  note?: ReactNode;
  steps: readonly string[];
  step: number;
  // Steps after this one cannot be opened yet.
  reached: number;
  // Every step but the open one shows as done, as when editing.
  allDone?: boolean;
  onGo: (step: number) => void;
}

export function StepRail({
  back,
  title,
  note,
  steps,
  step,
  reached,
  allDone,
  onGo,
}: StepRailProps) {
  return (
    <nav className={styles.rail} aria-label="Setup steps">
      <button type="button" className={page.back} onClick={back.onClick}>
        ← {back.label}
      </button>
      <div className={styles.railHead}>
        <h1 className={styles.railTitle}>{title}</h1>
        {note}
      </div>
      <ol className={styles.stepList}>
        {steps.map((item, index) => {
          const done = index < step || (allDone === true && index !== step);
          return (
            <li key={item}>
              <button
                type="button"
                className={styles.stepItem}
                aria-current={index === step ? "step" : undefined}
                disabled={index > reached}
                onClick={() => onGo(index)}
              >
                <span className={`${styles.stepDot} ${done ? styles.stepDone : ""}`}>
                  {done ? <Check size={13} aria-label="Done" /> : index + 1}
                </span>
                <span className={styles.stepTitle}>{item}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={styles.progress} aria-hidden>
        <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
    </nav>
  );
}
