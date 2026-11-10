import type { TaskRecord } from "@office-town/contract";
import { api } from "../../api/client.ts";
import { type AppState, useApp } from "../../store/app-store.ts";
import { showToast } from "../../ui/Toast.tsx";

// The choices a task makes for itself, with the same words wherever they are picked: Settings
// for new tasks, the composer's Options, and a running task's run card.
export type TaskOption = "efficient";

export const TASK_OPTIONS: { key: TaskOption; label: string; hint: string }[] = [
  {
    key: "efficient",
    label: "Efficient mode",
    hint: "A long chat carries on fresh with a complete handover, so it uses fewer tokens.",
  },
];

export type TaskOptions = Record<TaskOption, boolean>;

export const optionsOf = (task: TaskRecord): TaskOptions => ({
  efficient: task.efficient === true,
});

const DEFAULTS = { efficient: "efficientByDefault" } as const satisfies Record<
  TaskOption,
  keyof AppState
>;

const SAVE_DEFAULT: Record<TaskOption, (on: boolean) => Promise<void>> = {
  efficient: api.saveEfficientDefault,
};

const SAVE_ON_TASK: Record<TaskOption, (taskId: string, on: boolean) => Promise<unknown>> = {
  efficient: api.setTaskEfficient,
};

export function useTaskDefaults(): TaskOptions {
  const efficient = useApp((state) => state.efficientByDefault);
  return { efficient };
}

// Saved at once; put back if the core refuses it.
export function saveTaskDefault(key: TaskOption, on: boolean): void {
  useApp.setState({ [DEFAULTS[key]]: on });
  SAVE_DEFAULT[key](on).catch(() => {
    useApp.setState({ [DEFAULTS[key]]: !on });
    showToast("The choice could not be saved.");
  });
}

export function setTaskOption(taskId: string, key: TaskOption, on: boolean): void {
  SAVE_ON_TASK[key](taskId, on).catch(() => showToast("The choice could not be saved."));
}
