import { ChevronDown } from "lucide-react";
import { memo } from "react";
import type { Agent } from "../../store/agents.ts";
import { navigate } from "../../store/app-store.ts";
import { ContextMenu, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ago } from "../../ui/format.ts";
import { useModelName } from "../profiles/model-line.ts";
import { effortLabel } from "../profiles/model-name.ts";
import { TaskStatusIcon } from "./TaskStatusIcon.tsx";
import styles from "./TasksView.module.css";
import type { Item } from "./task-list.ts";
import { taskMenu } from "./task-menu.ts";
import { WorkerName } from "./WorkerName.tsx";

export interface Team {
  key: string;
  name: string;
  colour: string | undefined;
}

// Handles stay in the office (D-59): a team's row shows faces and how many agents, one format for
// every team task (a3-20).
function Who({ item, team, byTeam }: { item: Item; team: Team; byTeam: boolean }) {
  const [first] = item.agents;
  const count = item.agents.length;
  const group = item.task?.workerAgentIds;
  if (group !== undefined) {
    return (
      <span className={styles.who}>
        <span className={styles.faces}>
          {item.agents.slice(0, 3).map((agent) => (
            <Avatar key={agent.id} name={agent.name} colour={agent.colour} size={20} />
          ))}
        </span>
        <span className={styles.whoName}>{group.length + 1} agents</span>
      </span>
    );
  }
  if (team.key === "solo" && first !== undefined) {
    return (
      <span className={styles.who}>
        <Avatar name={first.name} colour={first.colour} size={20} />
        <span className={styles.whoName}>
          {/* Under the Assistants heading, the model is all that tells them apart. */}
          {byTeam ? <ModelAndEffort agent={first} /> : <WorkerName agent={first} />}
        </span>
      </span>
    );
  }
  if (!byTeam || first === undefined) {
    return (
      <span className={styles.who}>
        <Avatar name={team.name} colour={team.colour ?? "var(--text-3)"} size={20} />
        <span className={styles.whoName}>{team.name}</span>
      </span>
    );
  }
  return (
    <span className={styles.who}>
      <span className={styles.faces}>
        {item.agents.slice(0, 3).map((agent) => (
          <Avatar key={agent.id} name={agent.name} colour={agent.colour} size={20} />
        ))}
      </span>
      <span className={styles.whoName}>{count === 1 ? "1 agent" : `${count} agents`}</span>
    </span>
  );
}

function ModelAndEffort({ agent }: { agent: Agent }) {
  const { options } = agent.latest;
  const model = useModelName(options, options.model);
  const text = options.effort === undefined ? model : `${model} · ${effortLabel(options.effort)}`;
  return <span title={text}>{text}</span>;
}

// Absent, the title takes its column.
function Progress({ item }: { item: Item }) {
  if (item.progress === undefined) return null;
  const { done, total, unit } = item.progress;
  const finished = done === total;
  return (
    <span className={styles.progress}>
      <span>
        {done} of {total} {unit}
      </span>
      <span className={styles.bar}>
        <span
          className={finished ? styles.barDone : styles.barFill}
          style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
        />
      </span>
    </span>
  );
}

function When({ item, now }: { item: Item; now: number }) {
  if (item.task === undefined) return <span className={styles.when} />;
  if (item.stuck) {
    const hours = Math.floor((now - Date.parse(item.activityAt)) / 3_600_000);
    return (
      <span className={`${styles.when} ${styles.stuck}`} title="No progress in the last hour">
        Stuck {hours} h
      </span>
    );
  }
  const open = item.status === "working" || item.status === "needs" || item.status === "queued";
  return (
    <span className={styles.when} title={open ? "Last activity" : "Finished"}>
      {ago(item.activityAt, now)}
    </span>
  );
}

interface TaskRowProps {
  item: Item;
  team: Team;
  // By team, a row names its agents; otherwise its team.
  byTeam: boolean;
  goalTitle?: string | undefined;
  nested?: boolean;
  expanded?: boolean;
  onToggleParts?: (() => void) | undefined;
  now: number;
}

// A row whose item and team read the same is not drawn again, so a long list stays still while
// one agent works (its item is the same object until its own records change).
export const TaskRow = memo(TaskRowView, (before, after) => {
  const { team: was, ...rest } = before;
  const { team: is, ...next } = after;
  const sameTeam = was.key === is.key && was.name === is.name && was.colour === is.colour;
  const keys = new Set([...Object.keys(rest), ...Object.keys(next)]) as Set<keyof typeof rest>;
  return sameTeam && [...keys].every((key) => rest[key] === next[key]);
});

function TaskRowView(props: TaskRowProps) {
  const { item, team, byTeam, goalTitle, nested = false, expanded, onToggleParts, now } = props;
  const task = item.task;
  const goal = item.progress?.unit === "parts";
  const lineClass =
    item.line?.tone === "ask" ? styles.ask : item.line?.tone === "error" ? styles.error : "";
  const open = () => {
    if (task !== undefined) navigate({ name: "task", taskId: task.id });
  };
  // Only an ask gets a button; everything else about a row is in its menu.
  const answerTaskId = item.status === "needs" ? item.answerTaskId : undefined;

  const cells = (
    <>
      <span className={styles.icon}>
        <TaskStatusIcon status={item.status} />
      </span>
      <span className={`${styles.text} ${item.progress === undefined ? styles.wide : ""}`}>
        <span className={styles.title}>
          {goal && !nested ? <span className={styles.goalTag}>Goal</span> : null}
          <span className={styles.titleText}>{item.title}</span>
        </span>
        {item.line === undefined ? null : (
          <span className={`${styles.line} ${lineClass}`}>{item.line.text}</span>
        )}
        {goalTitle === undefined ? null : <span className={styles.line}>Part of: {goalTitle}</span>}
      </span>
      <Progress item={item} />
      <Who item={item} team={team} byTeam={byTeam && !nested} />
      <When item={item} now={now} />
    </>
  );

  const row = (
    <li
      className={`${styles.row} ${item.status === "needs" && !goal ? styles.needs : ""} ${nested ? styles.nested : ""}`}
    >
      {task === undefined ? (
        <div className={styles.open}>{cells}</div>
      ) : (
        <button type="button" className={styles.open} onClick={open}>
          {cells}
        </button>
      )}
      <span className={styles.actions}>
        {onToggleParts === undefined ? null : (
          <Button
            variant="ghost"
            icon
            aria-expanded={expanded}
            aria-label={expanded ? "Hide parts" : "Show parts"}
            onClick={onToggleParts}
          >
            <ChevronDown size={14} className={expanded ? undefined : styles.folded} aria-hidden />
          </Button>
        )}
        {answerTaskId === undefined ? null : (
          <Button
            variant="primary"
            className={styles.answer}
            onClick={() => navigate({ name: "task", taskId: answerTaskId })}
          >
            Answer
          </Button>
        )}
      </span>
      {task === undefined ? (
        <span className={styles.menuSpace} />
      ) : (
        <MoreMenu menu={() => taskMenu(task.id)} label={`More for ${item.title}`} />
      )}
    </li>
  );
  return task === undefined ? row : <ContextMenu menu={() => taskMenu(task.id)}>{row}</ContextMenu>;
}
