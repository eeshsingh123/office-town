import { ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useKept } from "../store/kept.ts";
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
      <Steps steps={steps} />
      {children}
    </section>
  );
}

function Steps({ steps }: { steps: readonly GuideStep[] }) {
  return (
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
  );
}

// The same steps folded to one line, opened on a click: for a page the user knows already, and
// for Help (a2-31).
export function FoldedGuide({
  title,
  steps,
  columns,
}: {
  title: string;
  steps: readonly GuideStep[];
  // Steps per row where the page is narrow, such as Help's 760 px column.
  columns?: number;
}) {
  return (
    <details className={styles.folded}>
      <summary className={styles.foldedLine}>
        <ChevronRight size={14} aria-hidden className={styles.foldedChevron} />
        {title}
      </summary>
      <div
        className={
          columns === undefined ? styles.foldedBody : `${styles.foldedBody} ${styles.grid}`
        }
        style={columns === undefined ? undefined : ({ "--columns": columns } as CSSProperties)}
      >
        <Steps steps={steps} />
      </div>
    </details>
  );
}

export const useGuideHidden = (key: string) =>
  useKept<boolean>({ name: `${key}.guide-hidden`, lasts: "saved", start: false });

export const guideParts = {
  row: styles.miniRow,
  column: styles.miniColumn,
  chip: styles.miniChip,
};
