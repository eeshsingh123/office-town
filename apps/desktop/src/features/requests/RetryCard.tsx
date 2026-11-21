import type { UserRequestEvent } from "@office-town/contract";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../api/client.ts";
import { type AppState, useApp } from "../../store/app-store.ts";
import { requestKey } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmButton } from "../../ui/ConfirmDialog.tsx";
import { useAnswer } from "./answer.ts";
import styles from "./RequestCard.module.css";

type RetryEvent = Extract<UserRequestEvent, { type: "retry.requested" }>;

// "Content team's lead stopped after an error." The chief and a lead with no department by name.
export function stoppedLeadTitle(state: AppState, sessionId: string): string {
  const session = state.sessions[sessionId];
  const task = session === undefined ? undefined : state.tasks[session.taskId]?.task;
  if (session !== undefined && session.agentId === state.chiefId) {
    return "The chief stopped after an error.";
  }
  const department =
    task?.departmentId === undefined ? undefined : state.departments[task.departmentId];
  if (department !== undefined) return `${department.name}'s lead stopped after an error.`;
  const lead = session === undefined ? undefined : state.agents[session.agentId];
  return `${lead?.name ?? "The lead"} stopped after an error.`;
}

// A lead that failed again after its one automatic retry (D-120).
export function RetryCard({ event, context }: { event: RetryEvent; context?: ReactNode }) {
  const title = useApp((state) => stoppedLeadTitle(state, event.sessionId));
  const { sending, error, run } = useAnswer();
  const { requestId } = event.payload;
  const answer = (choice: "retry" | "stop") =>
    api.command(event.sessionId, { type: "answerRetry", requestId, answer: choice });
  return (
    <article
      id={requestKey(requestId)}
      className={styles.card}
      aria-label="A lead stopped after an error"
    >
      <div className={styles.head}>
        <TriangleAlert size={16} aria-hidden />
        Stopped after an error
      </div>
      <div className={styles.body}>
        {context}
        <strong>{title}</strong>
        {event.payload.error === undefined ? null : <span>{event.payload.error}</span>}
        <div className={styles.buttons}>
          <Button variant="primary" disabled={sending} onClick={() => run(() => answer("retry"))}>
            Try again
          </Button>
          <ConfirmButton
            variant="ghost"
            disabled={sending}
            ask={{
              title: "Stop this task?",
              description: "Everyone on it stops now. Send a message to resume.",
              confirmLabel: "Stop",
              run: () => answer("stop"),
            }}
          >
            Stop
          </ConfirmButton>
        </div>
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
