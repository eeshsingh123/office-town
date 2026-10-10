import { Check, CircleMinus, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import type { TraceAction } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { Usage } from "../departments/Usage.tsx";
import { tracedUsage } from "../departments/usage.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { MessageBox } from "../task/MessageBox.tsx";
import { ReviewDialog } from "../task/ReviewDialog.tsx";
import { AgentName } from "./AgentName.tsx";
import type { FloorAgent } from "./Floor.tsx";
import styles from "./Office.module.css";

function ActionLine({ action, live }: { action: TraceAction; live: boolean }) {
  const icon =
    action.status === "completed" ? (
      <Check size={14} className={styles.ok} aria-label="Done" />
    ) : action.status === "failed" ? (
      <X size={14} className={styles.bad} aria-label="Failed" />
    ) : live ? (
      <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="Running" />
    ) : (
      <CircleMinus size={14} className={styles.quiet} aria-label="Interrupted" />
    );
  return (
    <li className={styles.action}>
      <span className={styles.actionTitle}>{action.title}</span>
      {icon}
    </li>
  );
}

export function AgentPanel({ member }: { member: FloorAgent }) {
  const { agent, state, harness } = member;
  const { latest } = agent;
  const traces = useApp((app) => app.traces);
  const trace = traces[latest.id];
  const waiting = useApp((app) =>
    Object.values(app.waiting).find(({ event }) => event.sessionId === latest.id),
  );
  const [asking, setAsking] = useState(false);
  // Every session of its task, since the core does not sum usage per agent; the latest also for its step.
  useEffect(() => {
    for (const session of agent.sessions) loadTrace(session.id);
  }, [agent.sessions]);
  const usage = useMemo(() => tracedUsage(agent.sessions, traces), [agent.sessions, traces]);
  const progress = trace === undefined ? undefined : progressOf(trace);
  const live = isOpen(latest);
  const open = () => navigate({ name: "task", taskId: agent.taskId });

  return (
    <>
      <div className={styles.who}>
        <Avatar name={agent.name} colour={agent.colour} size={40} />
        <div className={styles.whoText}>
          <AgentName agentId={agent.id} name={agent.name} />
          <span>
            {harness}
            {latest.options.model === undefined ? "" : ` · ${latest.options.model}`}
            {latest.options.effort === undefined ? "" : ` · ${latest.options.effort}`}
          </span>
        </div>
        <span className={`${styles.pill} ${state === "waiting" ? styles.pillWaiting : ""}`}>
          {state === "waiting" ? "Waiting" : STATE_LABELS[state]}
        </span>
      </div>

      <div>
        <div className={styles.label}>Working on</div>
        <button type="button" className={styles.taskLink} onClick={open}>
          {taskTitle(agent.task.prompt)}
        </button>
        {progress?.step === undefined ? null : (
          <>
            <div className={styles.step}>
              Step {progress.step.number} of {progress.stepCount} · {progress.step.title}
            </div>
            <div className={styles.bar}>
              <i style={{ width: `${(progress.stepsDone / progress.stepCount) * 100}%` }} />
            </div>
          </>
        )}
      </div>

      {waiting === undefined ? null : <RequestCard event={waiting.event} />}

      {progress === undefined || progress.recent.length === 0 ? null : (
        <div>
          <div className={styles.label}>Latest</div>
          <ul className={styles.actions}>
            {progress.recent.map((action) => (
              <ActionLine key={action.id} action={action} live={live} />
            ))}
          </ul>
        </div>
      )}

      <Usage sessions={agent.sessions} usage={usage} />

      <div className={styles.panelActions}>
        <Button variant="primary" onClick={open}>
          Open full trace
        </Button>
        {agent.record.guest ? null : (
          <Button variant="ghost" onClick={() => setAsking(true)}>
            Send for review
          </Button>
        )}
        {live ? (
          <Button variant="ghost" onClick={() => void api.stop(latest.id)}>
            Stop
          </Button>
        ) : null}
      </div>
      <MessageBox agent={agent} className={styles.message} />
      <ReviewDialog agent={agent} open={asking} onOpenChange={setAsking} />
    </>
  );
}
