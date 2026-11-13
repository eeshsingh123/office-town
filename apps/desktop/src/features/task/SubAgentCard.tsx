import { Check, CircleMinus, CornerDownRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { currentStep, stepCount, subAgentDetails, subAgentsOf } from "../../trace/sub-agents.ts";
import type { TraceAction } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { elapsed } from "../../ui/format.ts";
import styles from "./SubAgent.module.css";
import { showSubAgent, useShownSubAgent } from "./sub-agent-state.ts";

export interface CardPlace {
  sessionId: string;
  live: boolean;
}

// Ticks each second while something runs, so its time reads true.
export function useClock(running: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function statusLine(action: TraceAction, now: string, live: boolean): string {
  if (action.status === "running") {
    return live ? `Running for ${elapsed(action.startedAt, now)}` : "Interrupted";
  }
  const took =
    action.endedAt === undefined ? "" : ` in ${elapsed(action.startedAt, action.endedAt)}`;
  return action.status === "completed" ? `Finished${took}` : `Failed${took}`;
}

// The sub-agent's own row in the trace: what it was asked, where it is, and a way in.
export function SubAgentCard({ action, place }: { action: TraceAction; place: CardPlace }) {
  const trace = useApp((state) => state.traces[place.sessionId]);
  const taskId = useApp((state) => state.sessions[place.sessionId]?.taskId);
  const running = action.status === "running" && place.live;
  const now = useClock(running);
  if (trace === undefined) return null;
  const details = subAgentDetails(action.input);
  const steps = stepCount(trace, action);
  const current = running ? currentStep(trace, action) : undefined;
  const meta = [
    details.type,
    steps === 0 ? undefined : steps === 1 ? "1 step" : `${steps} steps`,
    current === undefined ? undefined : `now: ${current.title}`,
  ].filter((part) => part !== undefined);
  return (
    <div className={`${styles.card} ${running ? styles.cardLive : ""}`}>
      <div className={styles.cardHead}>
        <CornerDownRight size={16} className={styles.accent} aria-hidden />
        <span className={styles.cardTitle}>Sub-agent: {action.title}</span>
        <span className={running ? styles.live : styles.meta}>
          {running ? <LoaderCircle size={12} className="spin" aria-hidden /> : null}
          {statusLine(action, now, place.live)}
        </span>
      </div>
      {details.prompt === undefined ? null : (
        <span className={styles.cardPrompt}>{details.prompt.split("\n")[0]}</span>
      )}
      <div className={styles.cardFoot}>
        <span className={styles.cardMeta}>{meta.join(" · ")}</span>
        {taskId === undefined ? null : (
          <Button
            className={styles.open}
            onClick={() => showSubAgent(taskId, place.sessionId, action.id)}
          >
            Open
          </Button>
        )}
      </div>
    </div>
  );
}

function RowStatus({ action, live, now }: { action: TraceAction; live: boolean; now: string }) {
  if (action.status === "completed")
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  if (action.status === "failed") return <X size={14} className={styles.bad} aria-label="Failed" />;
  if (!live) return <CircleMinus size={14} className={styles.quietIcon} aria-label="Interrupted" />;
  const minutes = Math.floor((Date.parse(now) - Date.parse(action.startedAt)) / 60_000);
  return <span className={styles.rowTime}>{minutes < 1 ? "now" : `${minutes}m`}</span>;
}

// Under an agent in "Who works on this": each sub-agent it started in this task, at work or done.
export function SubAgentRows({
  taskId,
  sessions,
}: {
  taskId: string;
  sessions: readonly { id: string; live: boolean }[];
}) {
  const traces = useApp((state) => state.traces);
  const [shown] = useShownSubAgent(taskId);
  const rows = sessions.flatMap(({ id, live }) => {
    const trace = traces[id];
    return trace === undefined ? [] : subAgentsOf(trace).map((action) => ({ id, live, action }));
  });
  const now = useClock(rows.some(({ action, live }) => live && action.status === "running"));
  if (rows.length === 0) return null;
  return (
    <div className={styles.rows}>
      {rows.map(({ id, live, action }) => {
        const chosen = shown?.sessionId === id && shown.actionId === action.id;
        const running = live && action.status === "running";
        return (
          <button
            key={action.id}
            type="button"
            className={`${styles.row} ${chosen ? styles.rowChosen : ""}`}
            aria-current={chosen ? "true" : undefined}
            onClick={() => showSubAgent(taskId, id, action.id)}
          >
            <CornerDownRight
              size={14}
              className={running ? styles.accent : styles.quietIcon}
              aria-hidden
            />
            <span className={styles.rowTitle}>{action.title}</span>
            <RowStatus action={action} live={live} now={now} />
          </button>
        );
      })}
    </div>
  );
}
