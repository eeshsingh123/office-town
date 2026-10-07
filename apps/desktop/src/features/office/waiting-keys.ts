import { useEffect } from "react";
import { focusAgent, navigate, useApp } from "../../store/app-store.ts";
import { nextWaiting, waitingOrder } from "./next-waiting.ts";
import { showMode } from "./office-state.ts";

export function goToNextWaiting(): void {
  const { waiting, sessions, focus, view } = useApp.getState();
  const next = nextWaiting(waitingOrder(waiting, sessions), focus?.agentId);
  if (next === undefined) return;
  showMode("floor");
  if (view.name !== "office") navigate({ name: "office" });
  focusAgent(next);
}

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// N goes to the next waiting agent and Esc lets go of it, wherever the user is, unless they type.
export function useWaitingKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
      if (modified || typingIn(event.target)) return;
      if (event.key === "n") {
        event.preventDefault();
        goToNextWaiting();
      } else if (event.key === "Escape" && !event.defaultPrevented) {
        if (useApp.getState().focus !== undefined) focusAgent(undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
