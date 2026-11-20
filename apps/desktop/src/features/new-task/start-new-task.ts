import { navigate, useApp } from "../../store/app-store.ts";
import { writeDraft } from "../../store/drafts.ts";
import { TARGET_DRAFT } from "./targets.ts";

// Puts the cursor at the end of the task box: at once when the box is on screen, and again on the
// next frame, after a menu that just closed (Ctrl K) has handed the focus back.
function focusTaskBox(): void {
  const put = () => {
    const box = document.getElementById("task-prompt");
    if (!(box instanceof HTMLTextAreaElement) || document.activeElement === box) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
  };
  put();
  requestAnimationFrame(put);
}

// Every New task goes through here: the sidebar button, Ctrl N, a department's +, its menu and
// panel. `target` picks who does it (a department's id, or SOLO, CHIEF, PROPOSE) in the box.
// Home and New task already hold the box, so there it is filled in place; elsewhere New task opens
// with it, and what was typed stays.
export function startNewTask(target?: string): void {
  if (target !== undefined) writeDraft(TARGET_DRAFT, target);
  const { name } = useApp.getState().view;
  if (name !== "home" && name !== "new-task") navigate({ name: "new-task" });
  focusTaskBox();
}
