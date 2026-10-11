import type { PlanStep } from "@office-town/contract";
import { Check, CircleDashed, ListChecks, LoaderCircle, X } from "lucide-react";
import { create } from "zustand";
import { Button } from "../../ui/Button.tsx";
import { type PaneSize, savedFlag, saveFlag, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import styles from "./TaskView.module.css";

const SIZE: PaneSize = { initial: 300, min: 240, max: 460 };
const HIDDEN = "steps-hidden";

const useSteps = create<{ hidden: boolean }>(() => ({ hidden: savedFlag(HIDDEN) }));

function setHidden(hidden: boolean) {
  useSteps.setState({ hidden });
  saveFlag(HIDDEN, hidden);
}

function StepIcon({ step }: { step: PlanStep }) {
  if (step.status === "completed")
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  if (step.status === "in_progress") {
    return <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="In progress" />;
  }
  return <CircleDashed size={14} className={styles.quiet} aria-label="Not started" />;
}

const doneOf = (plan: readonly PlanStep[]) =>
  plan.filter((step) => step.status === "completed").length;

// In the task header; only an agent that made a step list has one.
export function StepsButton({ plan }: { plan: readonly PlanStep[] }) {
  const hidden = useSteps((state) => state.hidden);
  return (
    <Button onClick={() => setHidden(!hidden)} aria-pressed={!hidden}>
      <ListChecks size={14} aria-hidden />
      Steps {doneOf(plan)}/{plan.length}
    </Button>
  );
}

export function StepsColumn({ plan }: { plan: readonly PlanStep[] }) {
  const hidden = useSteps((state) => state.hidden);
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
        <ol className={styles.plan}>
          {plan.map((step) => (
            <li
              key={step.id}
              className={step.status === "in_progress" ? styles.current : undefined}
            >
              <StepIcon step={step} />
              {step.title}
            </li>
          ))}
        </ol>
      </div>
      <ResizeHandle label="Resize steps" width={width} size={SIZE} edge="left" onResize={resize} />
    </aside>
  );
}
