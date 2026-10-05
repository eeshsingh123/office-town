import { shell } from "../../shell.ts";
import { workOf } from "../../store/agents.ts";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";

function show(state: AppState, { event }: WaitingRequest): void {
  const session = state.sessions[event.sessionId];
  const taskId = session?.taskId;
  const agent = session === undefined ? undefined : workOf(state, session.agentId, session.taskId);
  const body =
    event.type === "permission.requested"
      ? event.payload.title
      : (event.payload.questions[0]?.text ?? "It has a question");
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

// A system notification for each new request while the window is not in front. Requests already
// waiting when the app connects are in the queue, so only ones arriving while live notify.
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
