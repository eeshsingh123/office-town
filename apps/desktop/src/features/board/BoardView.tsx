import { agentColours, type PlanPiece, type TaskRecord } from "@office-town/contract";
import { Check, Clock, LoaderCircle, MessageSquare } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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

// A harness keeps one colour wherever it shows, without a list of harnesses to keep up.
function harnessColour(harness: string): string {
  const sum = [...harness].reduce((total, char) => total + char.charCodeAt(0), 0);
  return agentColours[sum % agentColours.length]?.value ?? "";
}

// Who works on a goal, the harness it runs on, and where its panel is.
type Known = Pick<AppState, "chiefId" | "agents" | "departments" | "sessions" | "tasks">;

function ownerOf(task: TaskRecord, state: Known) {
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
    open: () => {
      if (department !== undefined) selectRoom(department.id);
      else if (isChief && chiefId !== undefined) selectAgent(chiefId);
      else if (firstAgent !== undefined) selectAgent(firstAgent.id);
    },
  };
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

function useAsking(task: TaskRecord): string | undefined {
  return useApp((state) => {
    const sessionIds = new Set(state.tasks[task.id]?.sessionIds);
    const request = Object.values(state.waiting)
      .filter(({ event }) => sessionIds.has(event.sessionId))
      .sort((a, b) => a.position - b.position)[0];
    if (request === undefined) return undefined;
    const agentId = state.sessions[request.event.sessionId]?.agentId;
    const name = agentId === undefined ? undefined : state.agents[agentId]?.name;
    return `${name ?? "An agent"}: ${requestSummary(request.event)}`;
  });
}

function ReviewActions({
  task,
  kind,
  open,
}: {
  task: TaskRecord;
  kind: PanelKind;
  open: () => void;
}) {
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
          open();
          composeIn(kind);
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

function TaskCard({
  task,
  note,
  column,
}: {
  task: TaskRecord;
  note: CardNote | undefined;
  column: ColumnId;
}) {
  const chiefId = useApp((app) => app.chiefId);
  const agents = useApp((app) => app.agents);
  const departments = useApp((app) => app.departments);
  const sessions = useApp((app) => app.sessions);
  const tasks = useApp((app) => app.tasks);
  const state = { chiefId, agents, departments, sessions, tasks };
  const owner = ownerOf(task, state);
  const asking = useAsking(task);
  const ended = column === "review" ? lastEnd(task, state) : undefined;
  return (
    <article className={styles.card}>
      <button type="button" className={styles.main} onClick={owner.open}>
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
      {column === "review" ? (
        <ReviewActions task={task} kind={owner.kind} open={owner.open} />
      ) : null}
    </article>
  );
}

function PieceCard({ piece, note }: { piece: PlanPiece; note: CardNote }) {
  const departments = useApp((state) => state.departments);
  const lead = useApp((state) => {
    const department =
      piece.departmentId === undefined ? undefined : state.departments[piece.departmentId];
    return department === undefined ? undefined : state.agents[department.leadAgentId];
  });
  const harness = lead?.settings.harness ?? piece.newDepartment?.lead.harness;
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
          {departmentName(piece, departments)}
          <Harness harness={harness} />
        </span>
        <PartOf taskId={piece.taskId} />
      </button>
      <NoteLine note={note} />
    </article>
  );
}

function CardView({ card, column }: { card: BoardCard; column: ColumnId }) {
  if (card.kind === "piece") return <PieceCard piece={card.piece} note={card.note} />;
  return <TaskCard task={card.task} note={card.note} column={column} />;
}

// The goals and the plan pieces that wait for a department, in columns by what they need (D-49).
export function BoardView() {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const pieces = useApp((state) => state.pieces);
  const columns = useMemo(
    () => boardColumns({ tasks, sessions, pieces }),
    [tasks, sessions, pieces],
  );
  return (
    <div className={styles.board}>
      {COLUMNS.map((column) => (
        <section key={column.id} className={styles.column} aria-label={column.title}>
          <h2 className={styles.head}>
            {column.icon}
            {column.title}
            <span className={styles.count}>{columns[column.id].length}</span>
          </h2>
          {columns[column.id].map((card) => (
            <CardView
              key={card.kind === "task" ? card.task.id : card.piece.id}
              card={card}
              column={column.id}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
