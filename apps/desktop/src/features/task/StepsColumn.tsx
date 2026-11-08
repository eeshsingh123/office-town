import type { PlanStep } from "@office-town/contract";
import { Check, CircleDashed, CircleDot, ListChecks, LoaderCircle, X } from "lucide-react";
import { useKept, writeKept } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import { type PaneSize, paneFlag, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import styles from "./TaskView.module.css";

const SIZE: PaneSize = { initial: 300, min: 240, max: 460 };
const HIDDEN = paneFlag("steps-hidden");

const setHidden = (hidden: boolean) => writeKept(HIDDEN, hidden);

function StepIcon({ step, stale }: { step: PlanStep; stale: boolean }) {
  if (step.status === "completed")
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  if (step.status === "in_progress" && stale) {
    return <CircleDot size={14} className={styles.quiet} aria-label="Last step reported" />;
  }
  if (step.status === "in_progress") {
    return <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="In progress" />;
  }
  return <CircleDashed size={14} className={styles.quiet} aria-label="Not started" />;
}

const doneOf = (plan: readonly PlanStep[]) =>
  plan.filter((step) => step.status === "completed").length;

// In the task header; only an agent that made a step list has one.
export function StepsButton({ plan }: { plan: readonly PlanStep[] }) {
  const [hidden] = useKept(HIDDEN);
  return (
    <Button onClick={() => setHidden(!hidden)} aria-pressed={!hidden}>
      <ListChecks size={14} aria-hidden />
      Steps {doneOf(plan)}/{plan.length}
    </Button>
  );
}

export function StepsColumn({ plan, stale }: { plan: readonly PlanStep[]; stale: boolean }) {
  const [hidden] = useKept(HIDDEN);
  const [width, resize] = usePaneWidth("steps", SIZE);
  if (hidden) return null;
  const done = doneOf(plan);
  return (
    <aside className={styles.steps} style={{ width }} aria-labelledby="steps-title">
      <div className={styles.stepsHead}>
        <h2 id="steps-title">Steps</h2>
        <span className={styles.faint}>
          {done} of {plan.length} done
        </span>
        <button
          type="button"
          className={styles.stepsClose}
          onClick={() => setHidden(true)}
          aria-label="Hide steps"
          title="Hide steps"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className={styles.stepsBody}>
        <div className={styles.bar}>
          <i style={{ width: `${(done / plan.length) * 100}%` }} />
        </div>
        {stale ? <p className={styles.stepsNote}>Not updated for a while</p> : null}
        <ol className={styles.plan}>
          {plan.map((step) => (
            <li
              key={step.id}
              className={step.status === "in_progress" && !stale ? styles.current : undefined}
            >
              <StepIcon step={step} stale={stale} />
              {step.title}
            </li>
          ))}
        </ol>
      </div>
      <ResizeHandle label="Resize steps" width={width} size={SIZE} edge="left" onResize={resize} />
    </aside>
  );
}
