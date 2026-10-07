import { shell } from "../../shell.ts";
import { workOf } from "../../store/agents.ts";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";
import { requestSummary } from "./summary.ts";

function show(state: AppState, { event }: WaitingRequest): void {
  const session = state.sessions[event.sessionId];
  const taskId = session?.taskId;
  const agent = session === undefined ? undefined : workOf(state, session.agentId, session.taskId);
  const body = requestSummary(event);
  const notification = new Notification(`${agent?.name ?? "An agent"} needs you`, {
    body,
    tag: event.id,
  });
  notification.onclick = () => {
    void shell?.showWindow();
    window.focus();
    if (taskId !== undefined) navigate({ name: "task", taskId });
  };
}

// Only while the window is not in front; requests already waiting at connect are in the queue.
export function notifyNewRequests(): void {
  useApp.subscribe((state, previous) => {
    if (state.waiting === previous.waiting || state.connection !== "live") return;
    if (previous.connection !== "live" || document.hasFocus()) return;
    const fresh = Object.entries(state.waiting).filter(([key]) => !(key in previous.waiting));
    if (fresh.length === 0) return;
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    for (const [, request] of fresh) show(state, request);
  });
}
