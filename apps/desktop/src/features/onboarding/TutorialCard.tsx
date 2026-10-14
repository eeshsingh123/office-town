import { X } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./Tutorial.module.css";
import { nextStep, stopTutorial, useTutorial } from "./tutorial-state.ts";
import { tutorialById } from "./tutorials.ts";

const FIND_TRIES = 15;
const FIND_EVERY_MS = 200;

// Outlines the part of the screen a step is about and moves focus there, once it has drawn.
function useTarget(target: string | undefined) {
  useEffect(() => {
    if (target === undefined) return;
    let tries = 0;
    let marked: Element | null = null;
    const find = () => {
      marked = document.querySelector(`[data-tour="${target}"]`);
      if (marked === null) return tries++ < FIND_TRIES;
      marked.setAttribute("data-tour-on", "");
      marked.scrollIntoView({ block: "nearest" });
      marked
        .querySelector<HTMLElement>("textarea, input, button:not([disabled])")
        ?.focus({ preventScroll: true });
      return false;
    };
    const timer = window.setInterval(() => {
      if (!find()) window.clearInterval(timer);
    }, FIND_EVERY_MS);
    find();
    return () => {
      window.clearInterval(timer);
      marked?.removeAttribute("data-tour-on");
    };
  }, [target]);
}

export function TutorialCard() {
  const run = useTutorial((state) => state.run);
  const model = useTutorial((state) => state.model);
  const preparing = useTutorial((state) => state.preparing);
  const tutorial = run === undefined ? undefined : tutorialById(run.id);
  const step = run === undefined ? undefined : tutorial?.steps[run.step];
  const done = useApp((state) =>
    run === undefined || preparing || step?.done === undefined ? false : step.done(state, run),
  );
  useTarget(preparing ? undefined : step?.target);
  useEffect(() => {
    if (done) nextStep();
  }, [done]);

  if (run === undefined || tutorial === undefined || step === undefined) return null;
  const last = run.step === tutorial.steps.length - 1;
  return (
    <section className={styles.card} aria-labelledby="tutorial-step">
      <div className={styles.head}>
        <span className={styles.count}>
          {tutorial.title} · Step {run.step + 1} of {tutorial.steps.length}
        </span>
        <Button variant="ghost" icon aria-label="Stop tutorial" onClick={stopTutorial}>
          <X size={16} aria-hidden />
        </Button>
      </div>
      <div aria-live="polite" className={styles.body}>
        <h2 id="tutorial-step" className={styles.title}>
          {preparing ? "Getting ready" : step.title}
        </h2>
        <p className={styles.text}>
          {preparing ? "Finding a low-cost model to use. This takes a few seconds." : step.text}
        </p>
      </div>
      {run.step === 0 && model !== undefined && run.id !== "chief" && run.id !== "library" ? (
        <p className={styles.model}>
          {model.free
            ? `Runs on ${model.name}, a free model. Its answers can be weaker than a paid model's.`
            : `Runs on ${model.name} to keep usage low.`}
        </p>
      ) : null}
      <div className={styles.actions}>
        {preparing ? null : step.done === undefined ? (
          <Button variant="primary" onClick={nextStep}>
            {last ? "Finish" : "Next"}
          </Button>
        ) : (
          <Button variant="ghost" onClick={nextStep}>
            Skip this step
          </Button>
        )}
      </div>
    </section>
  );
}
