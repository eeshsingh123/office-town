import { agentColours, type TaskRecord } from "@office-town/contract";
import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import { ago, taskName } from "../../ui/format.ts";
import { composeIn, type PanelKind, selectAgent, selectRoom } from "../office/office-state.ts";
import { TaskStatusIcon } from "../tasks/TaskStatusIcon.tsx";
import { TeamFilter, useTeams } from "../tasks/TasksView.tsx";
import { buildItems, type Item, type RowStatus } from "../tasks/task-list.ts";
import { continueWork, taskMenu } from "../tasks/task-menu.ts";
import styles from "./Board.module.css";
import { boardColumns, type ColumnId, DONE_SHOWN } from "./board.ts";

const COLUMNS: { id: ColumnId; title: string; status: RowStatus }[] = [
  { id: "needs-you", title: "Needs you", status: "needs" },
  { id: "working", title: "Working", status: "working" },
  { id: "queued", title: "Queued", status: "queued" },
  { id: "review", title: "To review", status: "review" },
  { id: "ended", title: "Failed or stopped", status: "failed" },
  { id: "done", title: "Done", status: "done" },
];

// One colour per harness wherever it shows, without a list of harnesses to keep up.
function harnessColour(harness: string): string {
  const sum = [...harness].reduce((total, char) => total + char.charCodeAt(0), 0);
  return agentColours[sum % agentColours.length]?.value ?? "";
}

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
    who: department?.name ?? (isChief ? chief?.name : "Assistant") ?? "An agent",
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

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

// One line under the owner: what it asks, does, waits on, or how it ended.
function StatusLine({ item, outputs }: { item: Item; outputs: number }): ReactNode {
  const [error, setError] = useState<string>();
  const taskId = item.task?.id;
  const cont =
    taskId === undefined ? null : (
      <button
        type="button"
        className={styles.inline}
        onClick={() =>
          void continueWork(taskId).catch((failure: unknown) =>
            setError(failure instanceof Error ? failure.message : String(failure)),
          )
        }
      >
        Continue
      </button>
    );
  switch (item.status) {
    case "needs":
      return (
        <span className={`${styles.line} ${styles.ask}`}>{item.line?.text ?? "Asks you"}</span>
      );
    case "working":
    case "queued":
      return item.line === undefined ? null : (
        <span className={styles.line}>
          <span className={styles.clip}>{item.line.text}</span>
        </span>
      );
    case "stopped":
    case "failed":
      return (
        <span className={`${styles.line} ${item.status === "failed" ? styles.bad : ""}`}>
          <TaskStatusIcon status={item.status} size={13} />
          <span className={styles.clip}>
            {item.status === "failed" ? "Failed" : (item.line?.text ?? "Stopped")}
          </span>
          {cont}
          {error === undefined ? null : <span className={styles.error}>{error}</span>}
        </span>
      );
    case "review":
    case "done":
      return outputs === 0 || taskId === undefined ? null : (
        <button
          type="button"
          className={styles.chip}
          onClick={() => navigate({ name: "task", taskId, tab: "outputs" })}
        >
          {plural(outputs, "output")}
        </button>
      );
  }
}

function Card({ item, known, outputs }: { item: Item; known: Known; outputs: number }) {
  const { task } = item;
  const owner = task === undefined ? undefined : ownerOf(task, known);
  const goal = item.goalId === undefined ? undefined : known.tasks[item.goalId]?.task;
  const followUp =
    owner === undefined || task === undefined
      ? undefined
      : () => {
          openOwner(owner);
          composeIn(owner.kind, task.id);
        };
  return (
    <article className={`${styles.card} ${item.status === "needs" ? styles.needs : ""}`}>
      <div className={styles.titleRow}>
        <button
          type="button"
          className={styles.title}
          onClick={() => {
            if (owner !== undefined) openOwner(owner);
            else if (item.goalId !== undefined) navigate({ name: "task", taskId: item.goalId });
          }}
        >
          {item.title}
        </button>
        {task === undefined ? null : (
          <MoreMenu menu={() => taskMenu(task.id, followUp)} label={`More for ${item.title}`} />
        )}
      </div>
      <span className={styles.owner}>
        <span className={styles.who}>{owner?.who ?? "Not started"}</span>
        <Harness harness={owner?.harness} />
      </span>
      {goal === undefined ? null : (
        <span className={styles.line}>
          <span className={styles.clip}>Part of {taskName(goal)}</span>
        </span>
      )}
      <StatusLine item={item} outputs={outputs} />
      <div className={styles.foot}>
        {item.status === "needs" && item.answerTaskId !== undefined ? (
          <Button
            variant="primary"
            onClick={() => navigate({ name: "task", taskId: item.answerTaskId ?? item.id })}
          >
            Answer
          </Button>
        ) : item.progress !== undefined && item.status === "working" ? (
          <span className={styles.meta}>
            {item.progress.done} of {item.progress.total} {item.progress.unit}
          </span>
        ) : null}
        {task === undefined ? null : <span className={styles.time}>{ago(item.activityAt)}</span>}
      </div>
    </article>
  );
}

// The same statuses as Tasks. Each column scrolls on its own under a header that stays put.
export function BoardView() {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const pieces = useApp((state) => state.pieces);
  const waiting = useApp((state) => state.waiting);
  const traces = useApp((state) => state.traces);
  const chiefId = useApp((state) => state.chiefId);
  const outputs = useApp((state) => state.outputs);
  const teams = useTeams();
  const [query, setQuery] = useState("");
  const [chosenTeams, setChosenTeams] = useState<string[]>([]);

  const items = useMemo(
    () =>
      buildItems(
        { tasks, sessions, agents, departments, pieces, waiting, traces, chiefId },
        Date.now(),
      ),
    [tasks, sessions, agents, departments, pieces, waiting, traces, chiefId],
  );
  const outputCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const output of Object.values(outputs)) {
      counts.set(output.taskId, (counts.get(output.taskId) ?? 0) + 1);
    }
    return counts;
  }, [outputs]);
  const known = { chiefId, agents, departments, sessions, tasks };
  const words = query.trim().toLowerCase();
  const shown = items.filter((item) => {
    if (chosenTeams.length > 0 && !chosenTeams.includes(item.team)) return false;
    if (words === "") return true;
    const names = item.agents.map((agent) => agent.name).join(" ");
    const team = teams.get(item.team)?.name ?? "";
    return `${item.title} ${names} ${team}`.toLowerCase().includes(words);
  });
  const columns = boardColumns(shown);
  const present = [...teams.values()].filter((team) =>
    items.some((item) => item.team === team.key),
  );

  return (
    <div className={styles.page}>
      <div className={styles.filters}>
        <label className={styles.search}>
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search tasks, agents, teams"
            aria-label="Search the board"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <TeamFilter teams={present} chosen={chosenTeams} onChange={setChosenTeams} />
      </div>
      <div className={styles.board}>
        {COLUMNS.map((column) => {
          const cards = columns[column.id];
          const visible = column.id === "done" ? cards.slice(0, DONE_SHOWN) : cards;
          return (
            <section key={column.id} className={styles.column} aria-label={column.title}>
              <h2 className={styles.head}>
                <TaskStatusIcon status={column.status} />
                {column.title}
                <span
                  className={`${styles.count} ${column.id === "needs-you" && cards.length > 0 ? styles.badge : ""}`}
                >
                  {cards.length}
                </span>
              </h2>
              <div className={styles.lane}>
                {visible.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    known={known}
                    outputs={outputCounts.get(item.id) ?? 0}
                  />
                ))}
                {cards.length > visible.length ? (
                  <button
                    type="button"
                    className={styles.seeAll}
                    onClick={() => navigate({ name: "tasks" })}
                  >
                    Latest {DONE_SHOWN} shown · See all in Tasks
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
