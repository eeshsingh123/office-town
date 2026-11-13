import { forSession, useKept, writeKept } from "../../store/kept.ts";

export interface ShownSubAgent {
  sessionId: string;
  actionId: string;
}

const shownIn = (taskId: string) =>
  forSession<ShownSubAgent | undefined>(`task.${taskId}.sub-agent`, undefined);

// The agent whose message box takes focus once it shows, from the panel's Message button.
export const COMPOSER_FOCUS = forSession<string | undefined>("task.composer-focus", undefined);

// The sub-agent shown in the task's side column, in place of Progress.
export function useShownSubAgent(taskId: string): [ShownSubAgent | undefined, () => void] {
  const [shown, setShown] = useKept(shownIn(taskId));
  return [shown, () => setShown(undefined)];
}

export function showSubAgent(taskId: string, sessionId: string, actionId: string): void {
  writeKept(shownIn(taskId), { sessionId, actionId });
}

export function focusComposer(agentId: string): void {
  writeKept(COMPOSER_FOCUS, agentId);
}
