import { Eye, FolderOpen } from "lucide-react";
import { useState } from "react";
import { shell } from "../../shell.ts";
import { type Agent, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import styles from "./ReviewOffer.module.css";

const KEY = "office-town.review-declined";

function declinedTasks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function decline(taskId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...declinedTasks(), taskId]));
  } catch {
    // Without storage the offer simply comes back next time.
  }
}

interface ReviewOfferProps {
  // The lead, or the solo agent, whose finished work is offered for review.
  agent: Agent;
  // Everyone on the task, so a running team is not interrupted.
  members: readonly Agent[];
  // Short solo tasks do not get the offer; the composer still has the button.
  suggest: boolean;
  onReview: () => void;
  // Shows a reviewer's work; only a team view can.
  onShow?: ((agentId: string) => void) | undefined;
}

// The end of the chat: once the work is done, a review is the natural next step (D-54).
export function ReviewOffer({ agent, members, suggest, onReview, onShow }: ReviewOfferProps) {
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions();
  const [declined, setDeclined] = useState(() => declinedTasks().has(agent.taskId));
  const states = new Map(
    members.map((member) => [member.id, stateOf(member, traces, waiting.has(member.latest.id))]),
  );
  const busy = (member: Agent) => {
    const state = states.get(member.id);
    return state === "working" || state === "starting" || state === "waiting";
  };
  const reviewers = members.filter((member) => member.record.guest === true);
  const reviewing = reviewers.find(busy);
  const reviewed = reviewers.at(-1);
  const folder = agent.latest.options.workspacePath;

  if (reviewing !== undefined) {
    return (
      <div className={styles.card} role="status">
        <Avatar name={reviewing.name} colour={reviewing.colour} size={22} />
        <p className={styles.text}>
          <strong>{reviewing.name} is reviewing the work.</strong>
          <span>You will see what it finds here when it is done.</span>
        </p>
        {onShow === undefined ? null : (
          <Button variant="ghost" onClick={() => onShow(reviewing.id)}>
            Watch
          </Button>
        )}
      </div>
    );
  }
  if (members.some(busy)) return null;
  if (reviewed !== undefined) {
    return (
      <div className={styles.card}>
        <Avatar name={reviewed.name} colour={reviewed.colour} size={22} />
        <p className={styles.text}>
          <strong>{reviewed.name} reviewed this work.</strong>
          <span>Read what it found, then reply here to have anything fixed.</span>
        </p>
        <div className={styles.actions}>
          {onShow === undefined ? null : (
            <Button variant="primary" onClick={() => onShow(reviewed.id)}>
              Read the review
            </Button>
          )}
          <Button variant="ghost" onClick={onReview}>
            Review again
          </Button>
        </div>
      </div>
    );
  }
  // Interrupted, stopped or failed work is not done, so it is not offered.
  const finished = states.get(agent.id) === "idle" || states.get(agent.id) === "done";
  if (!suggest || declined || !finished) return null;
  return (
    <div className={styles.card}>
      <Eye size={18} className={styles.icon} aria-hidden />
      <p className={styles.text}>
        <strong>Done. Do you want this work reviewed?</strong>
        <span>
          A fresh agent from outside the team checks it and tells you what it finds. It works on a
          copy, so nothing changes.
        </span>
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onReview}>
          Send for review
        </Button>
        {shell === undefined || folder === undefined ? null : (
          <Button variant="ghost" onClick={() => void shell?.openFolder(folder)}>
            <FolderOpen size={14} aria-hidden />
            See the files
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            decline(agent.taskId);
            setDeclined(true);
          }}
        >
          No thanks
        </Button>
      </div>
    </div>
  );
}
