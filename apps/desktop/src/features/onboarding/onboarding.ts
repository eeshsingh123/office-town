import type { Display, Onboarding } from "@office-town/contract";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

// Shown at once; the core keeps it for the next start.
export async function saveOnboarding(change: Partial<Onboarding>): Promise<void> {
  const onboarding = { ...useApp.getState().onboarding, ...change };
  useApp.setState({ onboarding });
  await api.saveOnboarding(onboarding);
}

export function markTutorialDone(id: string): Promise<void> {
  const done = useApp.getState().onboarding?.tutorialsDone ?? [];
  return saveOnboarding({ tutorialsDone: done.includes(id) ? done : [...done, id] });
}

export async function saveDisplay(change: Partial<Display>): Promise<void> {
  const display = { ...useApp.getState().display, ...change };
  useApp.setState({ display });
  await api.saveDisplay(display);
}
