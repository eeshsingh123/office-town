import { ArrowLeft, ExternalLink, LoaderCircle, Square } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { agentOf, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { type AgentState, progressOf } from "../../trace/progress.ts";
import { requestKey } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, environmentName, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { AgentAside } from "./AgentAside.tsx";
import { MessageBox } from "./MessageBox.tsx";
import { SessionTrace } from "./SessionTrace.tsx";
import styles from "./TaskView.module.css";

function pillStyle(state: AgentState): string | undefined {
  if (state === "waiting") return styles.pillWaiting;
  return state === "working" || state === "starting" ? styles.pillWorking : undefined;
}
// How close to the end, in pixels, still counts as reading the latest.
const FOLLOW_SLACK = 80;

// Keeps the latest work in view while the reader is at the end, and stays put once they scroll up.
function useFollow(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again whenever the content grows
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  }, [dependency]);
  const onScroll = () => {
    const element = ref.current;
    if (element === null) return;
    following.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK;
  };
  return { ref, onScroll };
}

export function TaskView({ taskId }: { taskId: string }) {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const agent = useMemo(
    () => agentOf({ tasks, sessions, waiting: {} }, taskId),
    [tasks, sessions, taskId],
  );
  const waitingSessions = useWaitingSessions();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) =>
    Object.values(state.waiting).find(({ event }) => event.sessionId === agent?.latest.id),
  );
  const harness = useHarnessName(agent?.latest.options.harness ?? "");
  const trace = agent === undefined ? undefined : traces[agent.latest.id];
  const follow = useFollow(`${trace?.position}:${trace?.streaming[""]?.length}`);

  useEffect(() => {
    if (agent === undefined) void track(taskId);
  }, [agent, taskId]);
  if (agent === undefined) return <p className={styles.loading}>Loading the task…</p>;

  const { latest } = agent;
  const state = stateOf(agent, traces, waitingSessions.has(latest.id));
  const progress = trace === undefined ? undefined : progressOf(trace);
  const folder = latest.options.workspacePath;
  const live = isOpen(latest);

  return (
    <section className={styles.view} aria-labelledby="task-title">
      <header className={styles.header}>
        <Button variant="ghost" onClick={() => navigate({ name: "office" })}>
          <ArrowLeft size={14} aria-hidden />
          Office
        </Button>
        <div className={styles.heading}>
          <div className={styles.titleLine}>
            <h1 id="task-title">{taskTitle(agent.task.prompt)}</h1>
            <span className={`${styles.pill} ${pillStyle(state) ?? ""}`}>
              {state === "waiting" ? "Waiting for you" : STATE_LABELS[state]}
            </span>
          </div>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <Avatar name={agent.name} colour={agent.colour} size={16} />
              {agent.name}
            </span>
            <span className={styles.chip}>{harness}</span>
            <span className={styles.chip}>
              {latest.options.model ?? trace?.model ?? "Default model"}
              {latest.options.effort === undefined ? "" : ` · ${latest.options.effort}`}
            </span>
            <span className={styles.chip}>{environmentName(latest.options.environment)}</span>
            <span className={styles.chip}>Started {clockTime(agent.task.createdAt)}</span>
          </div>
        </div>
        {shell !== undefined && folder !== undefined ? (
          <Button variant="ghost" onClick={() => void shell?.openFolder(folder)}>
            <ExternalLink size={14} aria-hidden />
            Open folder
          </Button>
        ) : null}
        {live ? (
          <Button onClick={() => void api.stop(latest.id)}>
            <Square size={12} aria-hidden />
            Stop
          </Button>
        ) : null}
      </header>

      {state === "working" || state === "starting" || state === "waiting" ? (
        <div className={styles.status} role="status">
          <LoaderCircle size={14} className={`${styles.running} spin`} aria-hidden />
          {progress?.step === undefined ? (
            <span className={styles.statusText}>
              {progress?.current?.title ?? STATE_LABELS[state]}
            </span>
          ) : (
            <>
              <span className={styles.faint}>
                Step {progress.step.number} of {progress.stepCount}
              </span>
              <span className={`${styles.strong} ${styles.statusText}`}>{progress.step.title}</span>
            </>
          )}
          {waiting === undefined ? null : (
            <>
              <span className={styles.waitingText}>
                {waiting.event.type === "permission.requested"
                  ? "Needs your approval"
                  : "Has a question for you"}
              </span>
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
            </>
          )}
        </div>
      ) : null}

      <div className={styles.body}>
        <div className={styles.column}>
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
            </div>
          </div>
          <div className={styles.traceWidth}>
            <MessageBox agent={agent} />
          </div>
        </div>
        <AgentAside
          first={agent.sessions[0] ?? latest}
          latest={latest}
          traces={agent.sessions.flatMap((session) => traces[session.id] ?? [])}
        />
      </div>
    </section>
  );
}
