import { shell } from "../../shell.ts";
import { workOf } from "../../store/agents.ts";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";
import { taskTitle } from "../../ui/format.ts";
import { DEFAULT_YOU } from "../you/you.ts";
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
// The user turns it off on their profile.
export function notifyNewRequests(): void {
  useApp.subscribe((state, previous) => {
    if (state.waiting === previous.waiting || state.connection !== "live") return;
    if (previous.connection !== "live" || document.hasFocus()) return;
    if (!(state.you ?? DEFAULT_YOU).notifyNeedsYou) return;
    const fresh = Object.entries(state.waiting).filter(([key]) => !(key in previous.waiting));
    if (fresh.length === 0) return;
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    for (const [, request] of fresh) show(state, request);
  });
}

// A task the user gave that ended, only when they asked for it on their profile. Pieces of a
// chief's plan are left out: the chief's own task ending says it once.
export function notifyFinishedTasks(): void {
  useApp.subscribe((state, previous) => {
    if (state.tasks === previous.tasks || state.connection !== "live") return;
    if (previous.connection !== "live" || document.hasFocus()) return;
    if (!(state.you ?? DEFAULT_YOU).notifyFinished) return;
    const ended = Object.values(state.tasks)
      .map((entry) => entry.task)
      .filter(
        (task) =>
          task.state === "ended" &&
          task.parentTaskId === undefined &&
          previous.tasks[task.id] !== undefined &&
          previous.tasks[task.id]?.task.state !== "ended",
      );
    if (ended.length === 0) return;
    if (Notification.permission === "default") void Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    for (const task of ended) {
      const notification = new Notification("A task is finished", {
        body: taskTitle(task.prompt),
        tag: `ended:${task.id}`,
      });
      notification.onclick = () => {
        void shell?.showWindow();
        window.focus();
        navigate({ name: "task", taskId: task.id });
      };
    }
  });
}
