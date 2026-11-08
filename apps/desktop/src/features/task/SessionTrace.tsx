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

// Where the drawn part of a run starts: a session, and how many of its first blocks are left out.
interface Start {
  index: number;
  skip: number;
}

// Steps back `count` blocks from `from`, or from the end. A trace not in yet stops it: that
// session shows whole while it loads, and the start is not settled.
function stepBack(
  lengths: readonly (number | undefined)[],
  from: Start | undefined,
  count: number,
): { start: Start; settled: boolean } {
  let index = from?.index ?? lengths.length - 1;
  let before = from === undefined ? lengths[index] : from.skip;
  let left = count;
  while (before !== undefined) {
    if (before >= left) return { start: { index, skip: before - left }, settled: true };
    left -= before;
    if (index === 0) return { start: { index, skip: 0 }, settled: true };
    index -= 1;
    before = lengths[index];
  }
  return { start: { index, skip: 0 }, settled: false };
}

// An agent's sessions in a task, oldest first, drawn from its latest work on.
export function AgentTrace({ sessions }: { sessions: readonly SessionRecord[] }) {
  // Fixed once the latest work is in, so new steps of a live run never push the top away.
  const [anchor, setAnchor] = useState<Start>();
  const [extra, setExtra] = useState(0);
  const traces = useApp(useShallow((state) => sessions.map((session) => state.traces[session.id])));
  const lengths = traces.map((trace) => (trace === undefined ? undefined : toBlocks(trace).length));
  const latest = stepBack(lengths, undefined, FIRST_BLOCKS);
  if (anchor === undefined && latest.settled) setAnchor(latest.start);
  const { start } = anchor === undefined ? latest : stepBack(lengths, anchor, extra);
  const earlier = anchor !== undefined && (start.index > 0 || start.skip > 0);
  return (
    <>
      {earlier ? (
        <div className={styles.earlier}>
          <Button variant="ghost" onClick={() => setExtra(extra + MORE_BLOCKS)}>
            Show earlier
          </Button>
        </div>
      ) : null}
      {sessions.slice(start.index).map((session, offset) => (
        <Fragment key={session.id}>
          {start.index + offset === 0 ? null : (
            <div className={task.divider}>Continued at {clockTime(session.createdAt)}</div>
          )}
          <SessionTrace session={session} skip={offset === 0 ? start.skip : 0} />
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
