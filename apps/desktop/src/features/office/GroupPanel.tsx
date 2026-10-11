import { ArrowUp, Pin, PinOff, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { select, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import type { AgentState } from "../../trace/progress.ts";
import { Button } from "../../ui/Button.tsx";
import { AgentCard, STATE_ORDER, toReview } from "./AgentCard.tsx";
import type { FloorAgent } from "./Floor.tsx";
import { GroupTaskDialog } from "./GroupTaskDialog.tsx";
import styles from "./Office.module.css";
import { pin, unpin, usePins } from "./pins.ts";

const AT_WORK: AgentState[] = ["working", "starting", "waiting"];

const SUMMARY: { label: string; states: AgentState[]; tone: string }[] = [
  { label: "needs you", states: ["waiting"], tone: "chipNeedsYou" },
  { label: "working", states: ["working", "starting"], tone: "" },
  { label: "failed", states: ["failed"], tone: "chipFailed" },
  { label: "done", states: ["done"], tone: "chipDone" },
  { label: "stopped", states: ["interrupted", "stopped"], tone: "chipQuiet" },
  { label: "idle", states: ["idle"], tone: "chipQuiet" },
];

function Summary({ members }: { members: FloorAgent[] }) {
  return (
    <div className={styles.summary}>
      {SUMMARY.map(({ label, states, tone }) => {
        const count = members.filter((member) => states.includes(member.state)).length;
        if (count === 0) return null;
        return (
          <span key={label} className={`${styles.summaryChip} ${tone ? styles[tone] : ""}`}>
            {count} {label}
          </span>
        );
      })}
    </div>
  );
}

// No "approve all": each ask is read and answered on its own.
export function GroupPanel({ members }: { members: FloorAgent[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [giving, setGiving] = useState(false);
  const chiefId = useApp((state) => state.chiefId);
  const pinned = usePins((state) => state.pinned);
  const ids = members.map(({ agent }) => agent.id);
  const allPinned = ids.every((id) => pinned.includes(id));
  const atWork = members.filter(
    ({ agent, state }) => isOpen(agent.latest) && AT_WORK.includes(state),
  );
  // The chief and reviewers stay out of a group task.
  const pickable = members.filter(
    ({ agent }) => agent.id !== chiefId && agent.record.guest !== true,
  );
  const sorted = members.toSorted(
    (a, b) =>
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
      Number(toReview(b.agent, b.state)) - Number(toReview(a.agent, a.state)),
  );

  const report = (results: PromiseSettledResult<unknown>[], verb: string) => {
    const failed = results.filter((result) => result.status === "rejected").length;
    setError(
      failed === 0 ? undefined : `${failed} of ${results.length} agents could not be ${verb}.`,
    );
  };
  // Busy ones get it now; finished ones take it up in their last task.
  const messageAll = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (message === "") return;
    setText("");
    report(
      await Promise.allSettled(members.map(({ agent }) => api.messageAgent(agent.id, message))),
      "reached",
    );
  };
  const stopAll = async () =>
    report(
      await Promise.allSettled(atWork.map(({ agent }) => api.stop(agent.latest.id))),
      "stopped",
    );

  return (
    <aside className={styles.panel} aria-label={`${members.length} selected agents`}>
      <div className={styles.groupHeader}>
        <div className={styles.groupTitle}>
          <strong>{members.length} agents</strong>
          <Button variant="ghost" onClick={() => select([])}>
            Clear
          </Button>
        </div>
        <Summary members={members} />
      </div>
      <div className={styles.groupCards}>
        {sorted.map(({ agent, group }) => (
          <AgentCard key={agent.id} agentId={agent.id} where={group || undefined} />
        ))}
      </div>
      <div className={styles.groupFooter}>
        <form className={styles.messageAll} onSubmit={messageAll}>
          <label htmlFor="message-all" className="visually-hidden">
            Message every selected agent
          </label>
          <textarea
            id="message-all"
            rows={1}
            value={text}
            placeholder={`Message all ${members.length}`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                void messageAll(event);
              }
            }}
          />
          <Button
            type="submit"
            variant="primary"
            icon
            aria-label="Message all"
            disabled={text.trim() === ""}
          >
            <ArrowUp size={16} aria-hidden />
          </Button>
        </form>
        <div className={styles.panelActions}>
          {pickable.length >= 2 ? (
            <Button onClick={() => setGiving(true)}>
              <Users size={14} aria-hidden />
              Give them a task
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => (allPinned ? unpin(ids) : pin(ids))}>
            {allPinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
            {allPinned ? "Unpin" : "Pin"}
          </Button>
          {atWork.length === 0 ? null : (
            <Button variant="ghost" onClick={() => void stopAll()}>
              Stop {atWork.length} at work
            </Button>
          )}
        </div>
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {giving ? (
        <GroupTaskDialog members={pickable.map(({ agent }) => agent)} onOpenChange={setGiving} />
      ) : null}
    </aside>
  );
}
