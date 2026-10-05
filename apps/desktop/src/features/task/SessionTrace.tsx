import type { SessionRecord } from "@office-town/contract";
import { Check, CircleDashed, CircleMinus, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { toBlocks } from "../../trace/blocks.ts";
import type { Trace } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./Trace.module.css";
import { ActionGroup, ItemView, type Place, Streaming } from "./TraceItems.tsx";

function StepHeading({ trace, stepId }: { trace: Trace; stepId: string }) {
  const index = trace.plan.findIndex((step) => step.id === stepId);
  const step = trace.plan[index];
  if (step === undefined) return null;
  const icon =
    step.status === "completed" ? (
      <Check size={14} className={styles.ok} aria-label="Done" />
    ) : step.status === "in_progress" ? (
      <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="In progress" />
    ) : (
      <CircleDashed size={14} className={styles.quiet} aria-label="Not started" />
    );
  return (
    <h3 className={styles.step}>
      {icon}
      <span className={styles.stepNumber}>{index + 1}</span>
      {step.title}
    </h3>
  );
}

function SessionEnd({ session, trace }: { session: SessionRecord; trace: Trace }) {
  // A guest leaves once it has answered; it is never brought back.
  const guest = useApp((state) => state.agents[session.agentId]?.guest === true);
  switch (session.status) {
    case "starting":
    case "running":
      return null;
    case "exited":
      return (
        <p className={styles.ended}>
          <Check size={14} className={styles.ok} aria-hidden />
          {trace.ended?.idle && !guest
            ? "Finished · stopped when idle, continues when needed"
            : "Finished"}
        </p>
      );
    case "stopped":
      return (
        <p className={styles.ended}>
          <CircleMinus size={14} aria-hidden />
          Stopped
        </p>
      );
    case "failed":
      return (
        <p className={`${styles.ended} ${styles.error}`}>
          <X size={14} aria-hidden />
          Failed
          {trace.ended?.exitCode == null ? "" : ` with exit code ${trace.ended.exitCode}`}
        </p>
      );
    case "interrupted":
      return (
        <p className={styles.ended}>
          <CircleMinus size={14} aria-hidden />
          Interrupted · send a message to continue
        </p>
      );
  }
}

export function SessionTrace({ session }: { session: SessionRecord }) {
  const trace = useApp((state) => state.traces[session.id]);
  const error = useApp((state) => state.traceErrors[session.id]);
  useEffect(() => loadTrace(session.id), [session.id]);
  const blocks = useMemo(() => (trace === undefined ? [] : toBlocks(trace)), [trace]);
  const place: Place = useMemo(() => ({ sessionId: session.id, live: isOpen(session) }), [session]);

  if (trace === undefined) {
    if (error === undefined) return <p className={styles.notice}>Loading…</p>;
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        This part of the trace could not be loaded: {error}
        <Button variant="ghost" onClick={() => loadTrace(session.id)}>
          Try again
        </Button>
      </p>
    );
  }
  return (
    <div className={styles.trace}>
      {blocks.map((block) =>
        block.kind === "item" ? (
          <ItemView key={block.id} id={block.id} place={place} />
        ) : (
          <div key={block.ids[0]}>
            {block.showsStep && block.stepId !== undefined ? (
              <StepHeading trace={trace} stepId={block.stepId} />
            ) : null}
            <ActionGroup ids={block.ids} place={place} />
          </div>
        ),
      )}
      <Streaming place={place} />
      <SessionEnd session={session} trace={trace} />
    </div>
  );
}
