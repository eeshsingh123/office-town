import { ChevronDown, Clock, MoreHorizontal } from "lucide-react";
import { AlertDialog, DropdownMenu } from "radix-ui";
import { useState } from "react";
import { navigate } from "../../store/app-store.ts";
import { deleteTask } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { ago } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { StatusIcon } from "../../ui/StatusIcon.tsx";
import { selectAgent, selectRoom } from "../office/office-state.ts";
import styles from "./TasksView.module.css";
import { type Item, type RowStatus, STATUS_LABELS } from "./task-list.ts";
import { WorkerName } from "./WorkerName.tsx";

export interface Team {
  key: string;
  name: string;
  colour: string | undefined;
}

function RowIcon({ status }: { status: RowStatus }) {
  switch (status) {
    case "needs":
      return <StatusIcon state="waiting" />;
    case "working":
      return <StatusIcon state="working" />;
    case "queued":
      return <Clock size={14} className={styles.quiet} aria-label={STATUS_LABELS.queued} />;
    case "review":
      return <span className={styles.unread} role="img" aria-label={STATUS_LABELS.review} />;
    case "done":
      return <StatusIcon state="done" />;
    case "failed":
      return <StatusIcon state="failed" />;
    case "stopped":
      return <StatusIcon state="stopped" />;
  }
}

// Handles stay in the office (D-59): a team's row shows faces and how many help the lead.
function Who({ item, team, byTeam }: { item: Item; team: Team; byTeam: boolean }) {
  const [first, ...others] = item.agents;
  if (team.key === "solo" && first !== undefined) {
    return (
      <span className={styles.who}>
        <Avatar name={first.name} colour={first.colour} size={20} />
        <span className={styles.whoName}>
          <WorkerName agent={first} />
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
      <span className={styles.whoName}>
        {team.key === "chief"
          ? first.name
          : others.length === 0
            ? "Lead"
            : `Lead + ${others.length}`}
      </span>
    </span>
  );
}

function Progress({ item }: { item: Item }) {
  if (item.progress === undefined) return <span className={styles.progress} />;
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

function RowMenu({ item, team }: { item: Item; team: Team }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const running = item.agents.some((agent) => isOpen(agent.latest));
  const task = item.task;
  if (task === undefined) return <span className={styles.menuSpace} />;
  const lead = item.agents[0];
  const openInOffice = () => {
    if (team.key !== "chief" && team.key !== "solo") selectRoom(team.key);
    else if (lead !== undefined) selectAgent(lead.id);
  };
  const confirm = async () => {
    try {
      await deleteTask(task.id);
      setConfirming(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" icon aria-label={`More for ${item.title}`}>
            <MoreHorizontal size={14} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
            {lead === undefined ? null : (
              <DropdownMenu.Item className={menu.item} onSelect={openInOffice}>
                Show in office
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={menu.item}
              disabled={running}
              onSelect={() => setConfirming(true)}
            >
              <span className={menu.itemText}>
                Delete task
                {running ? (
                  <span className={menu.itemDescription}>Stop its agents first</span>
                ) : null}
              </span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlertDialog.Root
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          setError(undefined);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className={dialog.overlay} />
          <AlertDialog.Content className={dialog.content}>
            <AlertDialog.Title className={dialog.title}>Delete this task?</AlertDialog.Title>
            <AlertDialog.Description className={dialog.description}>
              Its history is deleted. Files the agent made stay in the folder.
            </AlertDialog.Description>
            {error === undefined ? null : (
              <p className={dialog.error} role="alert">
                {error}
              </p>
            )}
            <div className={dialog.actions}>
              <AlertDialog.Cancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialog.Cancel>
              <Button variant="primary" onClick={confirm}>
                Delete task
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
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

export function TaskRow(props: TaskRowProps) {
  const { item, team, byTeam, goalTitle, nested = false, expanded, onToggleParts, now } = props;
  const task = item.task;
  const goal = item.progress?.unit === "parts";
  const lineClass =
    item.line?.tone === "ask" ? styles.ask : item.line?.tone === "error" ? styles.error : "";
  const open = () => {
    if (task !== undefined) navigate({ name: "task", taskId: task.id });
  };
  const action =
    item.status === "needs" && item.answerTaskId !== undefined
      ? { label: "Answer", primary: true, taskId: item.answerTaskId }
      : item.status === "review" && task !== undefined
        ? { label: "Review", primary: false, taskId: task.id }
        : undefined;

  const cells = (
    <>
      <span className={styles.icon}>
        <RowIcon status={item.status} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>
          {goal && !nested ? <span className={styles.goalTag}>Goal</span> : null}
          <span className={styles.titleText}>{item.title}</span>
        </span>
        {item.line === undefined ? null : (
          <span className={`${styles.line} ${lineClass}`}>{item.line.text}</span>
        )}
        {goalTitle === undefined ? null : <span className={styles.line}>Part of: {goalTitle}</span>}
      </span>
      <Who item={item} team={team} byTeam={byTeam && !nested} />
      <Progress item={item} />
      <When item={item} now={now} />
    </>
  );

  return (
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
        {action === undefined ? null : (
          <Button
            variant={action.primary ? "primary" : "secondary"}
            className={action.primary ? styles.answer : undefined}
            onClick={() => navigate({ name: "task", taskId: action.taskId })}
          >
            {action.label}
          </Button>
        )}
      </span>
      <RowMenu item={item} team={team} />
    </li>
  );
}
