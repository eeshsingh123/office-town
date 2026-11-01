import { LoaderCircle, Square } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { agentsInTask, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { type AgentState, type Progress, progressOf } from "../../trace/progress.ts";
import { requestKey } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { OutputsPane } from "../outputs/OutputsPane.tsx";
import { TaskTabs, useTaskTab } from "../outputs/TaskTabs.tsx";
import { useFollow } from "./follow.ts";
import { MessageBox } from "./MessageBox.tsx";
import { ReviewDialog } from "./ReviewDialog.tsx";
import { ReviewOffer } from "./ReviewOffer.tsx";
import { RunCard } from "./RunCard.tsx";
import { SessionTrace } from "./SessionTrace.tsx";
import { StepsButton, StepsColumn } from "./StepsColumn.tsx";
import { ReviewAction } from "./TaskTools.tsx";
import styles from "./TaskView.module.css";
import { TeamTaskView } from "./TeamTaskView.tsx";

// A solo task with a plan this long is offered a review once it is done.
const LONG_TASK_STEPS = 3;

const isBusy = (state: AgentState) => state === "working" || state === "starting";

function pillStyle(state: AgentState): string | undefined {
  if (state === "waiting") return styles.pillWaiting;
  return isBusy(state) ? styles.pillWorking : undefined;
}

// The step, or else what it is doing right now, for the pill's tooltip.
function doingNow(progress: Progress | undefined): string | undefined {
  if (progress?.step === undefined) return progress?.current?.title;
  return `Step ${progress.step.number} of ${progress.stepCount}: ${progress.step.title}`;
}

// A solo agent's task shows as a team once a guest joins it.
export function TaskView({ taskId }: { taskId: string }) {
  const several = useApp((state) => {
    const entry = state.tasks[taskId];
    if (entry?.task.leadAgentId !== undefined) return true;
    const agentIds = new Set(entry?.sessionIds.map((id) => state.sessions[id]?.agentId));
    return agentIds.size > 1;
  });
  return several ? <TeamTaskView taskId={taskId} /> : <SoloTaskView taskId={taskId} />;
}

function SoloTaskView({ taskId }: { taskId: string }) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const agent = useMemo(
    () => agentsInTask({ agents, tasks, sessions }, taskId)[0],
    [agents, tasks, sessions, taskId],
  );
  const waitingSessions = useWaitingSessions();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) =>
    Object.values(state.waiting).find(({ event }) => event.sessionId === agent?.latest.id),
  );
  const trace = agent === undefined ? undefined : traces[agent.latest.id];
  const follow = useFollow(
    `${taskId}:${agent?.id}`,
    `${trace?.position}:${trace?.streaming[""]?.length}`,
  );
  const [asking, setAsking] = useState(false);
  const tab = useTaskTab(taskId);

  useEffect(() => {
    if (agent === undefined) void track(taskId);
  }, [agent, taskId]);
  if (agent === undefined) return <p className={styles.loading}>Loading the task…</p>;

  const { latest } = agent;
  const state = stateOf(agent, traces, waitingSessions.has(latest.id));
  const progress = trace === undefined ? undefined : progressOf(trace);
  const live = isOpen(latest);
  const busy = isBusy(state);
  const asked =
    waiting === undefined
      ? undefined
      : waiting.event.type === "permission.requested"
        ? "Needs your approval"
        : "Has a question for you";
  // A resumed session reports no plan until it changes, so the latest known one shows.
  const plan = agent.sessions
    .map((session) => traces[session.id]?.plan ?? [])
    .findLast((steps) => steps.length > 0);

  return (
    <section className={styles.view} aria-labelledby="task-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <Crumbs items={[{ label: "Tasks", view: { name: "tasks" } }]} />
          <div className={styles.titleLine}>
            <h1 id="task-title">{taskTitle(agent.task.prompt)}</h1>
            <span
              className={`${styles.pill} ${pillStyle(state) ?? ""}`}
              role="status"
              title={busy ? doingNow(progress) : undefined}
            >
              {busy ? <LoaderCircle size={12} className="spin" aria-hidden /> : null}
              {asked ?? (state === "waiting" ? "Waiting for you" : STATE_LABELS[state])}
            </span>
            {waiting === undefined ? null : (
              <button
                type="button"
                className={styles.jump}
                onClick={() =>
                  document
                    .getElementById(requestKey(waiting.event.payload.requestId))
                    ?.scrollIntoView({ block: "center" })
                }
              >
                Jump to it
              </button>
            )}
          </div>
        </div>
        <TaskTabs taskId={taskId} />
        {plan === undefined || tab.outputs ? null : <StepsButton plan={plan} />}
        {live ? (
          <Button onClick={() => void api.stop(latest.id)}>
            <Square size={12} aria-hidden />
            Stop
          </Button>
        ) : null}
      </header>

      {tab.outputs ? (
        <OutputsPane taskId={taskId} chosen={tab.output} onChoose={tab.choose} />
      ) : (
        <div className={styles.body}>
          <div className={styles.column}>
            <RunCard agent={agent} />
            <div className={styles.scroll} ref={follow.ref} onScroll={follow.onScroll}>
              <div className={styles.traceWidth}>
                {agent.sessions.map((session, index) => (
                  <Fragment key={session.id}>
                    {index === 0 ? null : (
                      <div className={styles.divider}>
                        Continued at {clockTime(session.createdAt)}
                      </div>
                    )}
                    <SessionTrace session={session} />
                  </Fragment>
                ))}
                <ReviewOffer
                  agent={agent}
                  members={[agent]}
                  suggest={(progress?.stepCount ?? 0) >= LONG_TASK_STEPS}
                  onReview={() => setAsking(true)}
                />
              </div>
            </div>
            <div className={`${styles.traceWidth} ${styles.dock}`}>
              <MessageBox
                agent={agent}
                actions={<ReviewAction onClick={() => setAsking(true)} />}
              />
            </div>
          </div>
          {plan === undefined ? null : <StepsColumn plan={plan} />}
        </div>
      )}
      <ReviewDialog agent={agent} open={asking} onOpenChange={setAsking} />
    </section>
  );
}
