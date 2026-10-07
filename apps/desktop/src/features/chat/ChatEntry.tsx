import type { AgentRecord } from "@office-town/contract";
import { ChevronRight, CornerDownRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { clockTime } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { PieceIcon } from "../work/PieceIcon.tsx";
import { usePlan } from "../work/use-plan.ts";
import styles from "./Chat.module.css";
import type { ChatItem, DelegationThread, ThreadState } from "./chat-items.ts";

const DELEGATION_STATES: Record<string, ThreadState> = {
  working: "working",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  interrupted: "stopped",
};

function Said({
  who,
  meta,
  children,
}: {
  who: AgentRecord | undefined;
  meta: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.said}>
      {who === undefined ? (
        <span className={styles.noAvatar} aria-hidden />
      ) : (
        <Avatar name={who.name} colour={who.colour} size={24} />
      )}
      <div className={styles.saidBody}>
        <div className={styles.meta}>
          {who === undefined ? null : <strong>{who.name}</strong>}
          {meta}
        </div>
        {children}
      </div>
    </div>
  );
}

// A brief can be long, with the agent's instructions; it opens on request.
function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={open ? undefined : styles.clamped}>
        <Markdown text={text} />
      </div>
      <button type="button" className={styles.more} onClick={() => setOpen(!open)}>
        {open ? "Show less" : "Show all"}
      </button>
    </div>
  );
}

function Thread({
  head,
  state,
  brief,
  result,
}: {
  head: ReactNode;
  state: ThreadState;
  brief: string;
  result: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.thread}>
      <button
        type="button"
        className={styles.threadHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} className={open ? styles.turned : undefined} aria-hidden />
        <span className={styles.threadTitle}>{head}</span>
        <PieceIcon status={state} />
      </button>
      {open ? (
        <div className={styles.threadBody}>
          {brief === "" ? null : (
            <div>
              <div className={styles.label}>Brief</div>
              <Markdown text={brief} />
            </div>
          )}
          <div>
            <div className={styles.label}>Result</div>
            {result === undefined ? (
              <span className={styles.quiet}>Not yet.</span>
            ) : (
              <Markdown text={result} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DelegationEntry({ thread }: { thread: DelegationThread }) {
  const worker = useApp((state) =>
    thread.workerId === undefined ? undefined : state.agents[thread.workerId],
  );
  const record = useApp((state) =>
    thread.delegationId === undefined ? undefined : state.delegations[thread.delegationId],
  );
  const state =
    thread.result === undefined && record !== undefined
      ? (DELEGATION_STATES[record.status] ?? thread.state)
      : thread.state;
  const name = worker?.name ?? thread.workerName ?? "a worker";
  return (
    <Thread
      head={
        <>
          {worker === undefined ? null : (
            <Avatar name={worker.name} colour={worker.colour} size={18} />
          )}
          Brief to {name}
          {thread.result === undefined ? "" : " · Result"}
        </>
      }
      state={state}
      brief={thread.brief}
      result={thread.result}
    />
  );
}

function HandoffEntry({
  item,
  goalId,
}: {
  item: Extract<ChatItem, { kind: "handoff" }>;
  goalId: string;
}) {
  const plan = usePlan(goalId);
  const departments = useApp((state) => state.departments);
  const piece = plan.find((one) => one.id === item.pieceId);
  const department =
    piece?.departmentId === undefined
      ? piece?.newDepartment?.name
      : departments[piece.departmentId]?.name;
  return (
    <Thread
      head={`Hand-off to ${department ?? "a department"}${piece === undefined ? "" : ` · ${piece.title}`}`}
      state={item.state}
      brief={piece?.brief ?? ""}
      result={item.result}
    />
  );
}

interface ChatEntryProps {
  item: ChatItem;
  // Whose conversation this is.
  speaker: AgentRecord;
  noted: ReadonlySet<string>;
  goalId: string;
}

export function ChatEntry({ item, speaker, noted, goalId }: ChatEntryProps) {
  const from = useApp((state) =>
    item.kind === "passed" && item.from !== undefined ? state.agents[item.from] : undefined,
  );
  const lead = useApp((state) => {
    const departmentId = speaker.departmentId;
    const department = departmentId === undefined ? undefined : state.departments[departmentId];
    return department === undefined ? undefined : state.agents[department.leadAgentId];
  });
  switch (item.kind) {
    case "user":
      return (
        <div className={styles.mine}>
          <div className={styles.bubble}>
            <Markdown text={item.text} />
          </div>
          <span className={styles.meta}>You · {clockTime(item.at)}</span>
          {noted.has(item.text.trim()) && lead !== undefined ? (
            <span className={styles.noted}>
              <CornerDownRight size={12} aria-hidden />
              Noted to {lead.name}
            </span>
          ) : null}
        </div>
      );
    case "agent":
      return (
        <Said who={speaker} meta={` · ${clockTime(item.at)}`}>
          <Markdown text={item.text} />
        </Said>
      );
    case "passed":
      return (
        <Said
          who={from}
          meta={`${from === undefined ? "" : " · "}${item.brief ? "brief" : "message"} · ${clockTime(item.at)}`}
        >
          {item.brief ? <Brief text={item.text} /> : <Markdown text={item.text} />}
        </Said>
      );
    case "notice":
      return <p className={styles.notice}>{item.text}</p>;
    case "delegation":
      return <DelegationEntry thread={item} />;
    case "handoff":
      return <HandoffEntry item={item} goalId={goalId} />;
  }
}
