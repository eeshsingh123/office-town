import { Check } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./TutorialList.module.css";
import { startTutorial } from "./tutorial-state.ts";
import { sharedApps, TUTORIALS, type Tutorial, type TutorialId } from "./tutorials.ts";

// Each tutorial ticks itself off from what the user really did.
export function useTutorialsDone(): Record<TutorialId, boolean> {
  return useApp(
    useShallow((state) => ({
      "first-task": Object.values(state.tasks).some(
        ({ task }) => task.state === "idle" || task.state === "ended",
      ),
      department: Object.keys(state.departments).length > 0,
      chief: Object.keys(state.pieces).length > 0,
      library: Object.keys(state.library).length > 0,
      apps: sharedApps(state) > 0,
    })),
  );
}

// Why each tutorial cannot start yet, in list order.
const useBlocked = (): (string | undefined)[] =>
  useApp(useShallow((state) => TUTORIALS.map((tutorial) => tutorial.blocked?.(state))));

// The first tutorial the user has not done and can start: Home's one next step.
export function useNextTutorial(): Tutorial | undefined {
  const done = useTutorialsDone();
  const blocked = useBlocked();
  return TUTORIALS.find((tutorial, index) => !done[tutorial.id] && blocked[index] === undefined);
}

// The one list of tutorials, in Help (a1-18).
export function TutorialList() {
  const done = useTutorialsDone();
  const blocked = useBlocked();
  return (
    <ol className={styles.list}>
      {TUTORIALS.map((tutorial, index) => {
        const why = blocked[index];
        const finished = done[tutorial.id];
        return (
          <li key={tutorial.id} className={styles.step}>
            <span className={`${styles.mark} ${finished ? styles.done : ""}`}>
              {finished ? <Check size={12} aria-label="Done" /> : index + 1}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{tutorial.title}</span>
              <span className={styles.line}>{why ?? tutorial.summary}</span>
            </span>
            {finished ? null : (
              <Button disabled={why !== undefined} onClick={() => void startTutorial(tutorial.id)}>
                Start tutorial
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
