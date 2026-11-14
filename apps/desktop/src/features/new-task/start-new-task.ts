import { navigate, useApp } from "../../store/app-store.ts";

// Home already holds the box, so New task there only puts the cursor in it.
export function startNewTask(): void {
  if (useApp.getState().view.name === "home") {
    document.getElementById("task-prompt")?.focus();
    return;
  }
  navigate({ name: "new-task" });
}
