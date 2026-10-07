import { agentColours, type PlanPiece, type TaskRecord } from "@office-town/contract";
import { Check, Clock, LoaderCircle, MessageSquare } from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type AppState, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { StatusIcon } from "../../ui/StatusIcon.tsx";
import { composeIn, type PanelKind, selectAgent, selectRoom } from "../office/office-state.ts";
import { requestSummary } from "../requests/summary.ts";
import { PieceIcon } from "../work/PieceIcon.tsx";
import { departmentName } from "../work/use-plan.ts";
import styles from "./Board.module.css";
import { type BoardCard, boardColumns, type CardNote, type ColumnId } from "./board.ts";

const COLUMNS: { id: ColumnId; title: string; icon: ReactNode }[] = [
  { id: "needs-you", title: "Needs you", icon: <StatusIcon state="waiting" /> },
  { id: "working", title: "Working", icon: <LoaderCircle size={14} className={styles.accent} /> },
  { id: "waiting", title: "Waiting", icon: <Clock size={14} className={styles.quiet} /> },
  { id: "review", title: "To review", icon: <span className={styles.unread} /> },
  { id: "done", title: "Done", icon: <Check size={14} className={styles.ok} /> },
];

// One colour per harness wherever it shows, without a list of harnesses to keep up.
function harnessColour(harness: string): string {
  const sum = [...harness].reduce((total, char) => total + char.charCodeAt(0), 0);
  return agentColours[sum % agentColours.length]?.value ?? "";
}

// Plain values, so a card's props stay equal while its owner does.
type Known = Pick<AppState, "chiefId" | "agents" | "departments" | "sessions" | "tasks">;

interface Owner {
  who: string;
  harness: string | undefined;
  kind: PanelKind;
  roomId: string | undefined;
  agentId: string | undefined;
}

function ownerOf(task: TaskRecord, state: Known): Owner {
  const { chiefId, agents, departments, sessions, tasks } = state;
  const firstSession = sessions[tasks[task.id]?.sessionIds[0] ?? ""];
  const firstAgent = firstSession === undefined ? undefined : agents[firstSession.agentId];
  const chief = chiefId === undefined ? undefined : agents[chiefId];
  const department = task.departmentId === undefined ? undefined : departments[task.departmentId];
  const isChief = chiefId !== undefined && task.leadAgentId === chiefId;
  const harness = firstSession?.options.harness ?? (isChief ? chief?.settings.harness : undefined);
  const kind: PanelKind = department !== undefined ? "department" : isChief ? "chief" : "agent";
  return {
    who: department?.name ?? (isChief ? chief?.name : firstAgent?.name) ?? "An agent",
    harness,
    kind,
    roomId: department?.id,
    agentId: isChief ? chiefId : firstAgent?.id,
  };
}

function openOwner({ roomId, agentId }: Pick<Owner, "roomId" | "agentId">): void {
  if (roomId !== undefined) selectRoom(roomId);
  else if (agentId !== undefined) selectAgent(agentId);
}

function Harness({ harness }: { harness: string | undefined }) {
  const name = useApp(
    (state) => state.harnesses.find((known) => known.harness === harness)?.name ?? harness,
  );
  if (harness === undefined) return null;
  return (
    <span className={styles.harness}>
      <span className={styles.harnessDot} style={{ background: harnessColour(harness) }} />
      {name}
    </span>
  );
}

function NoteLine({ note, task }: { note: CardNote | undefined; task?: TaskRecord }) {
  const departments = useApp((state) => state.departments);
  const chiefName = useApp((state) =>
    state.chiefId === undefined ? "the chief" : (state.agents[state.chiefId]?.name ?? "the chief"),
  );
  const [error, setError] = useState<string>();
  if (note === undefined) return null;
  switch (note.kind) {
    case "waits-on": {
      const names = [...new Set(note.pieces.map((piece) => departmentName(piece, departments)))];
      return <span className={styles.note}>waits on {names.join(" and ") || "its turn"}</span>;
    }
    case "queued":
      return <span className={styles.note}>queued</span>;
    case "reported":
      return <span className={styles.note}>reported to {chiefName}</span>;
    case "reviewed":
      return <span className={styles.note}>Reviewed {clockTime(note.at)}</span>;
    case "cut-off": {
      const goal = task;
      return (
        <span className={styles.note}>
          cut off by a restart
          {goal?.leadAgentId === undefined ? null : (
            <>
              {" · "}
              <button
                type="button"
                className={styles.inline}
                onClick={() =>
                  void api
                    .continueTask(goal.id, "")
                    .then(() => track(goal.id))
                    .catch((failure: unknown) =>
                      setError(failure instanceof Error ? failure.message : String(failure)),
                    )
                }
              >
                Continue
              </button>
            </>
          )}
          {error === undefined ? null : <span className={styles.error}> {error}</span>}
        </span>
      );
    }
  }
}

function PartOf({ taskId }: { taskId: string | undefined }) {
  const goal = useApp((state) => (taskId === undefined ? undefined : state.tasks[taskId]?.task));
  if (goal === undefined) return null;
  return <span className={styles.note}>Part of {taskTitle(goal.prompt)}</span>;
}

// By task id: the agent's name and its oldest request.
function askingOf(state: Pick<AppState, "sessions" | "agents" | "waiting">) {
  const asking: Record<string, string> = {};
  const newestFirst = Object.values(state.waiting).sort((a, b) => b.position - a.position);
  for (const request of newestFirst) {
    const session = state.sessions[request.event.sessionId];
    if (session === undefined) continue;
    const name = state.agents[session.agentId]?.name;
    asking[session.taskId] = `${name ?? "An agent"}: ${requestSummary(request.event)}`;
  }
  return asking;
}

function ReviewActions({ task, owner }: { task: TaskRecord; owner: Owner }) {
  const [error, setError] = useState<string>();
  const markReviewed = async () => {
    try {
      const reviewed = await api.markReviewed(task.id);
      useApp.setState((state) => {
        const entry = state.tasks[task.id];
        return entry === undefined
          ? {}
          : { tasks: { ...state.tasks, [task.id]: { ...entry, task: reviewed } } };
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <div className={styles.actions}>
      <Button onClick={() => void markReviewed()}>
        <Check size={14} aria-hidden />
        Mark reviewed
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          openOwner(owner);
          composeIn(owner.kind, task.id);
        }}
      >
        <MessageSquare size={14} aria-hidden />
        Follow up
      </Button>
      {error === undefined ? null : <p className={styles.error}>{error}</p>}
    </div>
  );
}

function lastEnd(task: TaskRecord, state: Known): string | undefined {
  return (state.tasks[task.id]?.sessionIds ?? [])
    .flatMap((id) => state.sessions[id]?.endedAt ?? [])
    .sort()
    .at(-1);
}

interface TaskCardProps extends Owner {
  task: TaskRecord;
  note: CardNote | undefined;
  column: ColumnId;
  asking: string | undefined;
  ended: string | undefined;
}

const TaskCard = memo(function TaskCard({
  task,
  note,
  column,
  asking,
  ended,
  ...owner
}: TaskCardProps) {
  return (
    <article className={styles.card}>
      <button type="button" className={styles.main} onClick={() => openOwner(owner)}>
        <span className={styles.titleLine}>
          {column === "review" ? (
            <span role="img" className={styles.unread} aria-label="Not reviewed" />
          ) : null}
          <strong>{taskTitle(task.prompt)}</strong>
        </span>
        <span className={styles.owner}>
          {owner.who}
          <Harness harness={owner.harness} />
        </span>
        {asking === undefined ? null : <span className={styles.asking}>{asking}</span>}
        {ended === undefined ? null : (
          <span className={styles.note}>Finished {clockTime(ended)}</span>
        )}
        <PartOf taskId={task.parentTaskId} />
      </button>
      <NoteLine note={note} task={task} />
      {column === "review" ? <ReviewActions task={task} owner={owner} /> : null}
    </article>
  );
});

const PieceCard = memo(function PieceCard({
  piece,
  note,
  department,
  harness,
}: {
  piece: PlanPiece;
  note: CardNote;
  department: string;
  harness: string | undefined;
}) {
  const { departmentId } = piece;
  return (
    <article className={styles.card}>
      <button
        type="button"
        className={styles.main}
        onClick={() => {
          if (departmentId !== undefined) selectRoom(departmentId);
        }}
      >
        <span className={styles.titleLine}>
          <PieceIcon status={piece.status} />
          <strong>{piece.title}</strong>
        </span>
        <span className={styles.owner}>
          {department}
          <Harness harness={harness} />
        </span>
        <PartOf taskId={piece.taskId} />
      </button>
      <NoteLine note={note} />
    </article>
  );
});

// Cards get what they show as props, so a streamed change renders only the cards it touches.
export function BoardView() {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const pieces = useApp((state) => state.pieces);
  const delegations = useApp((state) => state.delegations);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const chiefId = useApp((state) => state.chiefId);
  const waiting = useApp((state) => state.waiting);
  const columns = useMemo(
    () => boardColumns({ tasks, sessions, pieces, delegations }),
    [tasks, sessions, pieces, delegations],
  );
  const asking = useMemo(
    () => askingOf({ sessions, agents, waiting }),
    [sessions, agents, waiting],
  );
  const known = { chiefId, agents, departments, sessions, tasks };

  const cardOf = (card: BoardCard, column: ColumnId) => {
    if (card.kind === "piece") {
      const { piece } = card;
      const department =
        piece.departmentId === undefined ? undefined : departments[piece.departmentId];
      const lead = department === undefined ? undefined : agents[department.leadAgentId];
      return (
        <PieceCard
          key={piece.id}
          piece={piece}
          note={card.note}
          department={departmentName(piece, departments)}
          harness={lead?.settings.harness ?? piece.newDepartment?.lead.harness}
        />
      );
    }
    const { task } = card;
    return (
      <TaskCard
        key={task.id}
        task={task}
        note={card.note}
        column={column}
        {...ownerOf(task, known)}
        asking={asking[task.id]}
        ended={column === "review" ? lastEnd(task, known) : undefined}
      />
    );
  };

  return (
    <div className={styles.board}>
      {COLUMNS.map((column) => (
        <section key={column.id} className={styles.column} aria-label={column.title}>
          <h2 className={styles.head}>
            {column.icon}
            {column.title}
            <span className={styles.count}>{columns[column.id].length}</span>
          </h2>
          {columns[column.id].map((card) => cardOf(card, column.id))}
        </section>
      ))}
    </div>
  );
}
