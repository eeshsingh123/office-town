import { Check } from "lucide-react";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./TutorialList.module.css";
import { startTutorial } from "./tutorial-state.ts";
import { sharedApps, TUTORIALS, type TutorialId } from "./tutorials.ts";

// Each tutorial ticks itself off from what the user really did.
export function useTutorialsDone(): Record<TutorialId, boolean> {
  const state = useApp();
  return {
    "first-task": Object.values(state.tasks).some(
      ({ task }) => task.state === "idle" || task.state === "ended",
    ),
    department: Object.keys(state.departments).length > 0,
    chief: Object.keys(state.pieces).length > 0,
    library: Object.keys(state.library).length > 0,
    apps: sharedApps(state) > 0,
  };
}

// The one list of tutorials, on Home, Help and the last setup step (a1-18).
export function TutorialList({ onStart }: { onStart?: (id: TutorialId) => void }) {
  const state = useApp();
  const done = useTutorialsDone();
  return (
    <ol className={styles.list}>
      {TUTORIALS.map((tutorial, index) => {
        const blocked = tutorial.blocked?.(state);
        const finished = done[tutorial.id];
        return (
          <li key={tutorial.id} className={styles.step}>
            <span className={`${styles.mark} ${finished ? styles.done : ""}`}>
              {finished ? <Check size={12} aria-label="Done" /> : index + 1}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{tutorial.title}</span>
              <span className={styles.line}>{blocked ?? tutorial.summary}</span>
            </span>
            {finished ? null : (
              <Button
                disabled={blocked !== undefined}
                onClick={() =>
                  onStart === undefined ? void startTutorial(tutorial.id) : onStart(tutorial.id)
                }
              >
                Start tutorial
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
