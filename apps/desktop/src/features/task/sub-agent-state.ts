import { forSession, readKept, useKept, writeKept } from "../../store/kept.ts";

export interface ShownSubAgent {
  sessionId: string;
  actionId: string;
}

const shownIn = (taskId: string) =>
  forSession<ShownSubAgent | undefined>(`task.${taskId}.sub-agent`, undefined);

// Asked each time the panel's Message button is pressed; the open composer takes it.
export const COMPOSER_FOCUS = forSession("task.composer-focus", 0);

// The sub-agent shown in the task's side column, in place of Progress.
export function useShownSubAgent(taskId: string): [ShownSubAgent | undefined, () => void] {
  const [shown, setShown] = useKept(shownIn(taskId));
  return [shown, () => setShown(undefined)];
}

export function showSubAgent(taskId: string, sessionId: string, actionId: string): void {
  writeKept(shownIn(taskId), { sessionId, actionId });
}

export function focusComposer(): void {
  writeKept(COMPOSER_FOCUS, readKept(COMPOSER_FOCUS) + 1);
}
