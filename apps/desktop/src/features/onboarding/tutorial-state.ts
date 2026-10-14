import { create } from "zustand";
import { useApp } from "../../store/app-store.ts";
import { markTutorialDone } from "./onboarding.ts";
import { findTutorialModel, type TutorialModel } from "./tutorial-model.ts";
import { type TutorialId, type TutorialRun, tutorialById } from "./tutorials.ts";

interface TutorialState {
  run: TutorialRun | undefined;
  model: TutorialModel | undefined;
  // While the AI apps list their models, which takes some seconds.
  preparing: boolean;
}

// Memory only: a tutorial left open when the app closes simply ends.
export const useTutorial = create<TutorialState>(() => ({
  run: undefined,
  model: undefined,
  preparing: false,
}));

export async function startTutorial(id: TutorialId): Promise<void> {
  const { departments, library } = useApp.getState();
  useTutorial.setState({
    model: undefined,
    preparing: true,
    run: {
      id,
      step: 0,
      startedAt: new Date().toISOString(),
      departments: Object.keys(departments).length,
      library: Object.keys(library).length,
    },
  });
  const model = await findTutorialModel();
  // Stopped while it was getting ready.
  if (useTutorial.getState().run?.id !== id) return;
  useTutorial.setState({ model, preparing: false });
  tutorialById(id).start(model);
}

export function nextStep(): void {
  const { run } = useTutorial.getState();
  if (run === undefined) return;
  if (run.step + 1 < tutorialById(run.id).steps.length) {
    useTutorial.setState({ run: { ...run, step: run.step + 1 } });
    return;
  }
  useTutorial.setState({ run: undefined });
  void markTutorialDone(run.id);
}

export function stopTutorial(): void {
  useTutorial.setState({ run: undefined, preparing: false });
}
