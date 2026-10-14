import { type CSSProperties, type ReactNode, useState } from "react";
import { Button } from "./Button.tsx";
import styles from "./Guide.module.css";

export interface GuideStep {
  title: string;
  text: string;
  // A small, simplified picture of the screen or idea.
  picture: ReactNode;
}

interface GuideProps {
  id: string;
  title: string;
  intro: string;
  steps: readonly GuideStep[];
  onHide: () => void;
  children?: ReactNode;
}

// How something works, in equal steps the user can hide.
export function Guide({ id, title, intro, steps, onHide, children }: GuideProps) {
  return (
    <section className={styles.guide} aria-labelledby={id}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id={id} className={styles.title}>
            {title}
          </h2>
          <p className={styles.intro}>{intro}</p>
        </div>
        <Button variant="ghost" onClick={onHide}>
          Hide
        </Button>
      </div>
      <ol className={styles.steps} style={{ "--steps": steps.length } as CSSProperties}>
        {steps.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.picture} aria-hidden>
              {step.picture}
            </span>
            <span className={styles.number}>Step {index + 1}</span>
            <strong className={styles.stepTitle}>{step.title}</strong>
            <span className={styles.stepText}>{step.text}</span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}

// Remembered in the browser; a convenience only.
export function useGuideHidden(key: string): [boolean, (hidden: boolean) => void] {
  const storageKey = `office-town.${key}.guide-hidden`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  const remember = (next: boolean) => {
    setHidden(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Remembering this is a convenience only.
    }
  };
  return [hidden, remember];
}

export const guideParts = {
  row: styles.miniRow,
  column: styles.miniColumn,
  chip: styles.miniChip,
};
