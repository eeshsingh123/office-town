import { LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { useApp, useHarnessName } from "../../store/app-store.ts";
import { useTraces } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { stepCount, subAgentDetails } from "../../trace/sub-agents.ts";
import type { Trace, TraceAction } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { type PaneSize, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import { useModelName } from "../profiles/model-line.ts";
import { ProgressColumn } from "./ProgressColumn.tsx";
import styles from "./SubAgent.module.css";
import { statusLine, useClock } from "./SubAgentCard.tsx";
import { focusComposer, useShownSubAgent } from "./sub-agent-state.ts";
import task from "./TaskView.module.css";
import { ItemView, type Place } from "./TraceItems.tsx";

// The same place and width as Progress, which it stands in for while open.
const SIZE: PaneSize = { initial: 340, min: 280, max: 480 };
const PROMPT_LINES = 6;

function Prompt({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.split("\n").length > PROMPT_LINES || text.length > PROMPT_LINES * 60;
  return (
    <section className={styles.section}>
      <span className={styles.label}>Prompt</span>
      <div className={`${styles.prompt} ${long && !full ? styles.clamped : ""}`}>{text}</div>
      {long ? (
        <button type="button" className={styles.link} onClick={() => setFull(!full)}>
          {full ? "Show less" : "Show the full prompt"}
        </button>
      ) : null}
    </section>
  );
}

function Steps({ action, trace, place }: { action: TraceAction; trace: Trace; place: Place }) {
  const session = useApp((state) => state.sessions[place.sessionId]);
  const provider = useHarnessName(session?.options.harness ?? "");
  const shared = trace.subAgents?.steps ?? false;
  return (
    <section className={styles.section}>
      <span className={styles.label}>Steps</span>
      {action.children.length > 0 ? (
        <div className={styles.steps}>
          {action.children.map((id) => (
            <ItemView key={id} id={id} place={place} />
          ))}
        </div>
      ) : (
        <span className={styles.meta}>
          {shared ? "No steps yet." : `${provider} does not share a sub-agent's steps.`}
        </span>
      )}
    </section>
  );
}

function Panel({
  action,
  trace,
  place,
  onClose,
  onMessage,
}: {
  action: TraceAction;
  trace: Trace;
  place: Place;
  onClose: () => void;
  onMessage: (agentId: string) => void;
}) {
  const session = useApp((state) => state.sessions[place.sessionId]);
  const agent = useApp((state) =>
    session === undefined ? undefined : state.agents[session.agentId],
  );
  const details = subAgentDetails(action.input);
  const model = useModelName(session?.options, details.model);
  const running = action.status === "running" && place.live;
  const now = useClock(running);
  const steps = stepCount(trace, action);
  const name = agent?.name ?? "its agent";
  const started = [
    details.type,
    details.model === undefined ? undefined : model,
    details.background ? "in the background" : undefined,
  ].filter((part) => part !== undefined);
  return (
    <>
      <div className={styles.head}>
        <div className={styles.headLine}>
          <span className={styles.label}>Sub-agent</span>
          <button
            type="button"
            className={task.stepsClose}
            onClick={onClose}
            aria-label="Close the sub-agent"
            title="Close"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
        <h2 className={styles.title}>{action.title}</h2>
        <div className={styles.by}>
          <span className={styles.meta}>Started by</span>
          {agent === undefined ? null : (
            <Avatar name={agent.name} colour={agent.colour} size={18} />
          )}
          <span>{name}</span>
        </div>
        {started.length === 0 ? null : <span className={styles.meta}>{started.join(" · ")}</span>}
        <span className={running ? styles.live : styles.meta}>
          {running ? <LoaderCircle size={12} className="spin" aria-hidden /> : null}
          {statusLine(action, now, place.live)}
          {steps === 0 ? "" : ` · ${steps === 1 ? "1 step" : `${steps} steps`}`}
        </span>
      </div>
      <div className={styles.body}>
        {details.prompt === undefined ? null : <Prompt text={details.prompt} />}
        <Steps action={action} trace={trace} place={place} />
        <section className={styles.section}>
          <span className={styles.label}>Result</span>
          {action.result === undefined || action.result === "" ? (
            <span className={styles.meta}>
              Shows here when the sub-agent finishes, and goes to {name}.
            </span>
          ) : (
            <div className={styles.result}>
              <Markdown text={action.result} />
            </div>
          )}
        </section>
      </div>
      <div className={styles.foot}>
        <span className={styles.footNote}>
          Sub-agents take no messages. Tell {name} to change its work.
        </span>
        {agent === undefined ? null : (
          <Button onClick={() => onMessage(agent.id)}>Message {agent.name}</Button>
        )}
      </div>
    </>
  );
}

// The sub-agent the user opened, else Progress.
export function SideColumn({
  taskId,
  soloAgentId,
  onMessage = () => {},
}: {
  taskId: string;
  soloAgentId?: string;
  onMessage?: (agentId: string) => void;
}) {
  const [shown, close] = useShownSubAgent(taskId);
  const [width, resize] = usePaneWidth("progress", SIZE);
  useTraces(shown === undefined ? [] : [shown.sessionId]);
  const trace = useApp((state) =>
    shown === undefined ? undefined : state.traces[shown.sessionId],
  );
  const live = useApp((state) => {
    const session = shown === undefined ? undefined : state.sessions[shown.sessionId];
    return session !== undefined && isOpen(session);
  });
  const action = shown === undefined ? undefined : trace?.items.get(shown.actionId);
  if (shown === undefined || trace === undefined || action?.kind !== "action") {
    return <ProgressColumn taskId={taskId} {...(soloAgentId ? { soloAgentId } : {})} />;
  }
  return (
    <aside className={`${task.steps} ${styles.panel}`} style={{ width }} aria-label="Sub-agent">
      <Panel
        action={action}
        trace={trace}
        place={{ sessionId: shown.sessionId, live }}
        onClose={close}
        onMessage={(agentId) => {
          onMessage(agentId);
          focusComposer(agentId);
        }}
      />
      <ResizeHandle
        label="Resize the sub-agent"
        width={width}
        size={SIZE}
        edge="left"
        onResize={resize}
      />
    </aside>
  );
}
