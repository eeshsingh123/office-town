import { X } from "lucide-react";
import { useMemo } from "react";
import { type Agent, stateOf, useAgent } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen, type WaitingRequest } from "../../store/records.ts";
import { type AgentState, progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { requestLabel } from "../needs-you/request-label.ts";
import styles from "./AgentCard.module.css";
import { selectAgent } from "./office-state.ts";

// Those that need the user come first.
export const STATE_ORDER: AgentState[] = [
  "waiting",
  "working",
  "starting",
  "failed",
  "done",
  "idle",
  "interrupted",
  "stopped",
];

// On a task that has not ended, so it cannot join another (the core's rule too).
export function isBusy(agent: Agent): boolean {
  return isOpen(agent.latest) && (agent.task.state === "working" || agent.task.state === "waiting");
}

// Finished on its own and not reviewed yet; a stopped or failed task is not offered for review.
export const toReview = (agent: Agent, state: AgentState) =>
  state === "done" &&
  agent.task.state === "ended" &&
  agent.task.reviewedAt === undefined &&
  agent.task.parentTaskId === undefined;

export interface AgentStatus {
  agent: Agent;
  state: AgentState;
  // What it asks, does now, or last did.
  line: string;
}

function lineOf(
  agent: Agent,
  state: AgentState,
  request: WaitingRequest | undefined,
  trace: Trace | undefined,
): string {
  const title = taskTitle(agent.task.prompt);
  if (request !== undefined) return requestLabel(request);
  if (state === "working" || state === "starting") {
    const progress = trace === undefined ? undefined : progressOf(trace);
    if (progress?.step !== undefined) {
      return `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
    }
    return progress?.current?.title ?? title;
  }
  return state === "idle" ? title : `${STATE_LABELS[state]} · ${title}`;
}

export function useAgentStatus(agentId: string): AgentStatus | undefined {
  const agent = useAgent(agentId);
  const trace = useApp((state) =>
    agent === undefined ? undefined : state.traces[agent.latest.id],
  );
  const waiting = useApp((state) => state.waiting);
  return useMemo(() => {
    if (agent === undefined) return undefined;
    const request = Object.values(waiting).find((one) => one.event.sessionId === agent.latest.id);
    const state = stateOf(
      agent,
      trace === undefined ? {} : { [agent.latest.id]: trace },
      request !== undefined,
    );
    return { agent, state, line: lineOf(agent, state, request, trace) };
  }, [agent, trace, waiting]);
}

// Its one main action, as on the Board: answer what it asks, or review what it finished.
function MainAction({ status }: { status: AgentStatus }) {
  const { agent, state } = status;
  if (state === "waiting") {
    return (
      <Button className={styles.answer} onClick={() => selectAgent(agent.id)}>
        Answer
      </Button>
    );
  }
  if (toReview(agent, state)) {
    return <Button onClick={() => navigate({ name: "task", taskId: agent.taskId })}>Review</Button>;
  }
  return <StatusIcon state={state} />;
}

interface AgentCardProps {
  agentId: string;
  // Shown after the line, such as the room it sits in.
  where?: string | undefined;
  onUnpin?: () => void;
}

export function AgentCard({ agentId, where, onUnpin }: AgentCardProps) {
  const status = useAgentStatus(agentId);
  if (status === undefined) return null;
  const { agent, state, line } = status;
  return (
    <div className={`${styles.card} ${state === "waiting" ? styles.needsYou : ""}`}>
      <button
        type="button"
        className={styles.open}
        onClick={() => selectAgent(agent.id)}
        aria-label={`${agent.name}: ${line}`}
      >
        <Avatar name={agent.name} colour={agent.colour} size={24} />
        <span className={styles.text}>
          <strong>{agent.name}</strong>
          <span>{where === undefined ? line : `${line} · ${where}`}</span>
        </span>
      </button>
      <MainAction status={status} />
      {onUnpin === undefined ? null : (
        <button
          type="button"
          className={styles.unpin}
          onClick={onUnpin}
          aria-label={`Unpin ${agent.name}`}
          title="Unpin"
        >
          <X size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}
