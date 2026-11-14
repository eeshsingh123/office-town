import { Check, Eye } from "lucide-react";
import { useState } from "react";
import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { OPEN_CHECK, useChecks } from "../../store/checks.ts";
import { useKept } from "../../store/kept.ts";
import { markDone } from "../../store/reviewers.ts";
import { Button } from "../../ui/Button.tsx";
import { useResults } from "../outputs/use-task-outputs.ts";
import { statusOfTask } from "../tasks/task-list.ts";
import styles from "./ReviewBar.module.css";
import { FIXES_SENT, failingCount, sendFixes } from "./ReviewOffer.tsx";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// While the task is To review and no check is running. The header pill already says the status.
export function useReviewBarShown(taskId: string): boolean {
  const status = useApp((state) => statusOfTask(state, taskId));
  const latest = useChecks(taskId).at(-1);
  return status === "review" && (latest === undefined || !OPEN_CHECK.has(latest.status));
}

// The one place for what closes a task, on Work and on Outputs: facts the pill does not give, then
// Send for review, Send fixes after a failed check, and Mark done (a3-8).
export function ReviewBar({ agent, onReview }: { agent: Agent; onReview: () => void }) {
  const shown = useReviewBarShown(agent.taskId);
  const checks = useChecks(agent.taskId);
  const outputs = useResults(agent.taskId).length;
  const sent = useKept(FIXES_SENT)[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!shown) return null;

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
  const facts = [
    failed > 0 && result !== undefined
      ? `${failed} of ${result.items.length} checks failed`
      : checklist > 0
        ? `${plural(checklist, "check", "checks")} written`
        : undefined,
    outputs === 0 ? undefined : plural(outputs, "output", "outputs"),
  ].filter(Boolean);

  return (
    <section className={styles.bar} aria-label="Review">
      <span className={styles.text}>
        {facts.length === 0 ? null : <span className={styles.facts}>{facts.join(" · ")}</span>}
        {error === undefined ? null : <span className={styles.error}>{error}</span>}
      </span>
      <Button variant="secondary" disabled={busy} onClick={onReview}>
        <Eye size={14} aria-hidden />
        Send for review
      </Button>
      {failed > 0 && result !== undefined ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void act(() => sendFixes(result))}
        >
          Send fixes ({failed})
        </Button>
      ) : null}
      <Button
        className={styles.done}
        disabled={busy}
        onClick={() => void act(() => markDone(agent.taskId))}
      >
        <Check size={14} aria-hidden />
        Mark done
      </Button>
    </section>
  );
}
