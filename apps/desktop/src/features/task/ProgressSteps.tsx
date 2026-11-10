import type { PlanStep } from "@office-town/contract";
import { Check, CircleDashed, CircleDot, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import styles from "./Progress.module.css";
import { askStep, pendingAsks, useStepAsks } from "./step-asks.ts";

export function StepIcon({ step, stale }: { step: PlanStep; stale: boolean }) {
  if (step.status === "completed") {
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  }
  if (step.status === "in_progress" && stale) {
    return <CircleDot size={14} className={styles.quiet} aria-label="Last step reported" />;
  }
  if (step.status === "in_progress") {
    return <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="In progress" />;
  }
  return <CircleDashed size={14} className={styles.quiet} aria-label="Not started" />;
}

function AskToAdd({ name, onAsk }: { name: string; onAsk: (step: string) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("");
  if (!open) {
    return (
      <button type="button" className={styles.add} onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        Ask {name} to add a step
      </button>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step.trim() === "") return;
    onAsk(step.trim());
    setStep("");
    setOpen(false);
  };
  return (
    <form className={styles.editor} onSubmit={submit}>
      <label className={styles.field}>
        Step
        <input
          className={styles.input}
          value={step}
          placeholder="For example: Add a clear button to search"
          // biome-ignore lint/a11y/noAutofocus: opened to type in
          autoFocus
          onChange={(change) => setStep(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </label>
      <div className={styles.editorFoot}>
        <span className={styles.hint}>{name} reads it at the next step.</span>
        <Button variant="ghost" className={styles.small} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          className={styles.small}
          disabled={step.trim() === ""}
        >
          Ask
        </Button>
      </div>
    </form>
  );
}

// The agent's own list from its AI app: the user asks for a change, and sees it until the
// list shows it (owner).
export function StepList({
  taskId,
  agent,
  plan,
  stale,
  live,
}: {
  taskId: string;
  agent: { id: string; name: string };
  plan: readonly PlanStep[];
  stale: boolean;
  // Asking only makes sense while the agent can still act on it.
  live: boolean;
}) {
  const all = useStepAsks((state) => state.asks);
  const asks = useMemo(() => pendingAsks(all, agent.id, plan), [all, agent.id, plan]);
  const [dropping, setDropping] = useState<string>();
  const ask = (change: "add" | "remove", step: string) =>
    askStep(taskId, agent.id, change, step, plan);
  const dropAsked = new Set(asks.filter((one) => one.change === "remove").map((one) => one.step));
  return (
    <>
      <ol className={styles.steps}>
        {plan.map((step) => (
          <li key={step.id}>
            <div
              className={`${styles.step} ${step.status === "in_progress" && !stale ? styles.stepCurrent : ""}`}
            >
              <StepIcon step={step} stale={stale} />
              <span className={styles.stepTitle}>
                {step.title}
                {dropAsked.has(step.title) ? (
                  <span className={`${styles.pill} ${styles.pillQuiet}`}>
                    Asked {agent.name} to drop it
                  </span>
                ) : null}
              </span>
              {live && step.status !== "completed" && !dropAsked.has(step.title) ? (
                <span className={styles.tools}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Ask ${agent.name} to drop this step`}
                    title="Ask to drop it"
                    onClick={() => setDropping(step.id)}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </span>
              ) : (
                <span />
              )}
            </div>
            {dropping === step.id ? (
              <div className={styles.confirm} role="alert">
                <span>Ask {agent.name} to drop this step?</span>
                <Button
                  variant="ghost"
                  className={styles.small}
                  onClick={() => setDropping(undefined)}
                >
                  Keep
                </Button>
                <Button
                  variant="danger"
                  className={styles.small}
                  onClick={() => {
                    setDropping(undefined);
                    ask("remove", step.title);
                  }}
                >
                  Ask
                </Button>
              </div>
            ) : null}
          </li>
        ))}
        {asks
          .filter((one) => one.change === "add")
          .map((one) => (
            <li key={one.id}>
              <div className={styles.step}>
                <CircleDashed size={14} className={styles.quiet} aria-label="Asked" />
                <span className={`${styles.stepTitle} ${styles.stepAsked}`}>
                  {one.step}
                  <span className={`${styles.pill} ${styles.pillQuiet}`}>Asked {agent.name}</span>
                </span>
                <span />
              </div>
            </li>
          ))}
      </ol>
      {live ? <AskToAdd name={agent.name} onAsk={(step) => ask("add", step)} /> : null}
    </>
  );
}
