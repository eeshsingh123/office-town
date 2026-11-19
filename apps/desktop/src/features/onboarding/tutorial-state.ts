import { create } from "zustand";
import { useApp } from "../../store/app-store.ts";
import { markTutorialDone } from "./onboarding.ts";
import { findTutorialModel, type TutorialModel } from "./tutorial-model.ts";
import {
  restoreChoices,
  sharedApps,
  type TutorialId,
  type TutorialRun,
  tutorialById,
} from "./tutorials.ts";

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

// `harness` is the provider picked in setup, for the first task to run on.
export async function startTutorial(id: TutorialId, harness?: string): Promise<void> {
  const state = useApp.getState();
  const { departments, library } = state;
  useTutorial.setState({
    model: undefined,
    preparing: true,
    run: {
      id,
      step: 0,
      startedAt: new Date().toISOString(),
      departments: Object.keys(departments).length,
      library: Object.keys(library).length,
      apps: sharedApps(state),
    },
  });
  const model = await findTutorialModel(harness);
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
  restoreChoices();
  void markTutorialDone(run.id);
}

export function stopTutorial(): void {
  useTutorial.setState({ run: undefined, preparing: false });
  restoreChoices();
}

// A tutorial left open when the app closed ends, and puts back what it replaced.
export function endLeftTutorial(): void {
  if (useTutorial.getState().run === undefined) restoreChoices();
}
