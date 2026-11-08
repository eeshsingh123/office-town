import type { SessionRecord } from "@office-town/contract";
import { Check, CircleDashed, CircleMinus, LoaderCircle, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app-store.ts";
import { loadTrace, useTraces } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { toBlocks } from "../../trace/blocks.ts";
import type { Trace } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { clockTime } from "../../ui/format.ts";
import task from "./TaskView.module.css";
import styles from "./Trace.module.css";
import { ActionGroup, ItemView, type Place, Stage, Streaming } from "./TraceItems.tsx";

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
  // A guest leaves once it has answered; nothing but the user brings it back.
  const guest = useApp((state) => state.agents[session.agentId]?.guest === true);
  const stoppedBy = trace.ended?.stoppedBy;
  const lead = useApp((state) =>
    stoppedBy === undefined ? undefined : (state.agents[stoppedBy.agentId]?.name ?? "its lead"),
  );
  switch (session.status) {
    case "starting":
    case "running":
      return null;
    case "exited":
      return (
        <p className={styles.ended}>
          <Check size={14} className={styles.ok} aria-hidden />
          {trace.ended?.idle && !guest ? "Finished · send a message to continue" : "Finished"}
        </p>
      );
    case "stopped":
      return (
        <p className={styles.ended}>
          <CircleMinus size={14} aria-hidden />
          {stoppedBy === undefined ? "Stopped" : `Stopped by ${lead}: ${stoppedBy.reason}`}
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

// A long run opens on its latest work; each "Show earlier" draws this many more blocks.
const FIRST_BLOCKS = 60;
const MORE_BLOCKS = 100;

// An agent's sessions in a task, oldest first. Older ones load only once shown.
export function AgentTrace({ sessions }: { sessions: readonly SessionRecord[] }) {
  const [limit, setLimit] = useState(FIRST_BLOCKS);
  const traces = useApp(useShallow((state) => sessions.map((session) => state.traces[session.id])));
  const shown: { session: SessionRecord; index: number; skip: number }[] = [];
  let left = limit;
  for (let index = sessions.length - 1; index >= 0 && left > 0; index -= 1) {
    const session = sessions[index];
    if (session === undefined) continue;
    const trace = traces[index];
    // Until it loads, its length is unknown, so nothing older shows yet.
    const count = trace === undefined ? left : toBlocks(trace).length;
    shown.unshift({ session, index, skip: Math.max(0, count - left) });
    left -= count;
  }
  const first = shown[0];
  const earlier = first !== undefined && (first.index > 0 || first.skip > 0);
  return (
    <>
      {earlier ? (
        <div className={styles.earlier}>
          <Button variant="ghost" onClick={() => setLimit(limit + MORE_BLOCKS)}>
            Show earlier
          </Button>
        </div>
      ) : null}
      {shown.map(({ session, index, skip }) => (
        <Fragment key={session.id}>
          {index === 0 ? null : (
            <div className={task.divider}>Continued at {clockTime(session.createdAt)}</div>
          )}
          <SessionTrace session={session} skip={skip} />
        </Fragment>
      ))}
    </>
  );
}

function SessionTrace({ session, skip }: { session: SessionRecord; skip: number }) {
  const trace = useApp((state) => state.traces[session.id]);
  const error = useApp((state) => state.traceErrors[session.id]);
  useTraces([session.id]);
  const blocks = useMemo(
    () => (trace === undefined ? [] : toBlocks(trace).slice(skip)),
    [trace, skip],
  );
  const place: Place = useMemo(() => ({ sessionId: session.id, live: isOpen(session) }), [session]);

  if (trace === undefined) {
    if (error === undefined) return <p className={styles.notice}>Loading…</p>;
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        This part of the activity could not be loaded: {error}
        <Button variant="ghost" onClick={() => loadTrace(session.id)}>
          Try again
        </Button>
      </p>
    );
  }
  return (
    <div className={styles.trace}>
      {blocks.map((block, index) =>
        block.kind === "item" ? (
          <ItemView key={block.id} id={block.id} place={place} />
        ) : (
          <div key={block.ids[0]}>
            {/* The first block shown names its step, even when the heading was above it. */}
            {(block.showsStep || (index === 0 && skip > 0)) && block.stepId !== undefined ? (
              <StepHeading trace={trace} stepId={block.stepId} />
            ) : null}
            <ActionGroup ids={block.ids} place={place} />
          </div>
        ),
      )}
      <Stage place={place} />
      <Streaming place={place} />
      <SessionEnd session={session} trace={trace} />
    </div>
  );
}
