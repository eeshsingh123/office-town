import { ArrowUpRight, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import type { TraceAction } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { ReviewDialog } from "../task/ReviewDialog.tsx";
import { tokenLine, useRunFacts } from "../task/run-facts.ts";
import { AgentName } from "./AgentName.tsx";
import type { FloorAgent } from "./Floor.tsx";
import styles from "./Office.module.css";
import { Facts, PanelHeader, PanelSection, StateChip } from "./SidePanel.tsx";

function DoneLine({ action }: { action: TraceAction }) {
  return (
    <li className={styles.action}>
      {action.status === "failed" ? (
        <X size={14} className={styles.bad} aria-label="Failed" />
      ) : (
        <Check size={14} className={styles.ok} aria-label="Done" />
      )}
      <span className={styles.actionTitle}>{action.title}</span>
      <time className={styles.actionTime}>{clockTime(action.endedAt ?? action.startedAt)}</time>
    </li>
  );
}

export function AgentHeader({ member }: { member: FloorAgent }) {
  const { agent, state } = member;
  const department = useApp((app) =>
    agent.record.departmentId === undefined
      ? undefined
      : app.departments[agent.record.departmentId],
  );
  const role = agent.record.guest
    ? "Reviewer"
    : department === undefined
      ? (agent.record.role ?? "Agent")
      : `${department.leadAgentId === agent.id ? "Lead" : (agent.record.role ?? "Member")} · ${department.name}`;
  return (
    <PanelHeader
      picture={<Avatar name={agent.name} colour={agent.colour} size={36} />}
      title={<AgentName agentId={agent.id} name={agent.name} />}
      subtitle={role}
      status={<StateChip state={state} />}
    />
  );
}

export function AgentNow({ member }: { member: FloorAgent }) {
  const { agent, state } = member;
  const { latest } = agent;
  const trace = useApp((app) => app.traces[latest.id]);
  const waiting = useApp((app) =>
    Object.values(app.waiting).find(({ event }) => event.sessionId === latest.id),
  );
  // Every session of its task, for its tokens; the latest also for its step.
  useEffect(() => {
    for (const session of agent.sessions) loadTrace(session.id);
  }, [agent.sessions]);
  const facts = useRunFacts(agent);
  const progress = trace === undefined ? undefined : progressOf(trace);
  const done = progress?.recent.filter((action) => action.status !== "running") ?? [];
  const busy = state === "working" || state === "starting";

  return (
    <>
      {waiting === undefined ? null : <RequestCard event={waiting.event} />}

      <PanelSection title="Working on">
        <button
          type="button"
          className={styles.taskLink}
          onClick={() => navigate({ name: "task", taskId: agent.taskId })}
        >
          {taskTitle(agent.task.prompt)}
          <ArrowUpRight size={14} aria-hidden />
        </button>
        {busy ? (
          <div className={styles.live}>
            <span className={styles.pulse} aria-hidden />
            <span className={styles.liveText}>{progress?.current?.title ?? "Thinking"}</span>
          </div>
        ) : null}
        {progress?.step === undefined || !busy ? null : (
          <div>
            <div className={styles.step}>
              Step {progress.step.number} of {progress.stepCount} · {progress.step.title}
            </div>
            <div className={styles.bar}>
              <i style={{ width: `${(progress.stepsDone / progress.stepCount) * 100}%` }} />
            </div>
          </div>
        )}
      </PanelSection>

      {done.length === 0 ? null : (
        <PanelSection title="Last done">
          <ul className={styles.actions}>
            {done.map((action) => (
              <DoneLine key={action.id} action={action} />
            ))}
          </ul>
        </PanelSection>
      )}

      <PanelSection title="Runs on">
        <Facts
          facts={[
            facts.harness,
            facts.model,
            facts.effort,
            facts.permissions.label,
            `${facts.duration} · ${tokenLine(facts.tokens)}`,
          ]}
        />
      </PanelSection>
    </>
  );
}

export function AgentFooter({ member }: { member: FloorAgent }) {
  const { agent } = member;
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => navigate({ name: "task", taskId: agent.taskId })}>
        Open task
      </Button>
      {agent.record.guest ? null : (
        <Button variant="ghost" onClick={() => setAsking(true)}>
          Send for review
        </Button>
      )}
      {isOpen(agent.latest) ? (
        <Button variant="ghost" onClick={() => void api.stop(agent.latest.id)}>
          Stop
        </Button>
      ) : null}
      <ReviewDialog agent={agent} open={asking} onOpenChange={setAsking} />
    </>
  );
}
