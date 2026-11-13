import { useState } from "react";
import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { OPEN_CHECK, useChecks } from "../../store/checks.ts";
import { useKept } from "../../store/kept.ts";
import { markDone } from "../../store/reviewers.ts";
import { Button } from "../../ui/Button.tsx";
import { statusOfTask } from "../tasks/task-list.ts";
import styles from "./ReviewBar.module.css";
import { FIXES_SENT, failingCount, sendFixes } from "./ReviewOffer.tsx";

// Above the message box while a task waits for review, so done and review are always in reach.
export function ReviewBar({ agent, onReview }: { agent: Agent; onReview: () => void }) {
  const status = useApp((state) => statusOfTask(state, agent.taskId));
  const checks = useChecks(agent.taskId);
  const sent = useKept(FIXES_SENT)[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const latest = checks.at(-1);
  if (status !== "review" || (latest !== undefined && OPEN_CHECK.has(latest.status))) return null;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const result = checks.findLast((check) => check.status === "done");
  const failed = result === undefined || sent.includes(result.id) ? 0 : failingCount(result);
  const checklist = agent.task.checklist?.items.length ?? 0;
  const text =
    failed > 0 && result !== undefined
      ? `${failed} of ${result.items.length} checks failed`
      : checklist > 0
        ? `${agent.name} finished and wrote ${checklist === 1 ? "1 check" : `${checklist} checks`}`
        : `${agent.name} finished`;

  return (
    <section className={styles.bar} aria-label="To review">
      <span className={styles.text}>
        <strong>{text}</strong>
        {error === undefined ? null : <span className={styles.error}>{error}</span>}
      </span>
      {failed > 0 && result !== undefined ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void act(() => sendFixes(result))}
        >
          Send fixes ({failed})
        </Button>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={onReview}>
          Send for review…
        </Button>
      )}
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => void act(() => markDone(agent.taskId))}
      >
        {failed > 0 ? "Accept" : "Mark done"}
      </Button>
    </section>
  );
}
