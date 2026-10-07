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

// Dialogs, menus and lists use letters themselves. The focus card is a dialog too, but N moves on
// from it.
const OWNS_KEYS =
  "[role=dialog]:not([data-focus-card]), [role=alertdialog], [role=menu], [role=listbox]";

function keysOwnedAt(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWNS_KEYS) !== null;
}

const modified = (event: KeyboardEvent) =>
  event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

// N goes to the next waiting agent and Esc lets go of it, wherever the user is, unless they type.
// N is read in the capture phase, before the focus card keeps its keys to itself.
export function useWaitingKeys(): void {
  useEffect(() => {
    const onNext = (event: KeyboardEvent) => {
      if (event.key !== "n" || modified(event) || event.defaultPrevented || event.repeat) return;
      if (typingIn(event.target) || keysOwnedAt(event.target)) return;
      event.preventDefault();
      goToNextWaiting();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || modified(event) || event.defaultPrevented) return;
      if (typingIn(event.target)) return;
      if (useApp.getState().focus !== undefined) focusAgent(undefined);
    };
    window.addEventListener("keydown", onNext, { capture: true });
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onNext, { capture: true });
      window.removeEventListener("keydown", onEscape);
    };
  }, []);
}
