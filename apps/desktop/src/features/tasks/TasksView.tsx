import { Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { deleteTask, loadOlderTasks } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { byteSize, clockTime, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { useLoaded } from "../../ui/use-loaded.ts";
import styles from "./TasksView.module.css";

// Past this, the history is worth pruning; deleting tasks is the only way to free it.
const LARGE_STORE_BYTES = 1024 ** 3;

function dayOf(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function DeleteTask({ agent }: { agent: Agent }) {
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const running = isOpen(agent.latest);
  const confirm = async () => {
    try {
      await deleteTask(agent.taskId);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(undefined);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button
          variant="ghost"
          icon
          disabled={running}
          title={running ? "Stop the agent before deleting its task" : undefined}
          aria-label={`Delete ${taskTitle(agent.task.prompt)}`}
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>Delete this task?</AlertDialog.Title>
          <AlertDialog.Description className={dialog.description}>
            Its whole trace is removed from the history. Files the agent made in its folder stay
            where they are.
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
  );
}

function TaskRow({ agent, waiting }: { agent: Agent; waiting: boolean }) {
  const traces = useApp((state) => state.traces);
  const harness = useHarnessName(agent.latest.options.harness);
  const state = stateOf(agent, traces, waiting);
  const continued = agent.sessions.length - 1;
  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.open}
        onClick={() => navigate({ name: "task", taskId: agent.taskId })}
      >
        <StatusIcon state={state} />
        <span className={styles.text}>
          <span className={styles.title}>{taskTitle(agent.task.prompt)}</span>
          <span className={styles.meta}>
            {agent.name} · {harness} · {clockTime(agent.task.createdAt)} · {STATE_LABELS[state]}
            {continued === 0
              ? ""
              : ` · continued ${continued === 1 ? "once" : `${continued} times`}`}
          </span>
        </span>
      </button>
      <DeleteTask agent={agent} />
    </li>
  );
}

function StoreSize() {
  const size = useLoaded("store-size", api.readStoreSize);
  if (size.value === undefined) return null;
  const total = size.value.databaseBytes + size.value.resultBytes;
  if (total < LARGE_STORE_BYTES) {
    return <p className={styles.size}>The history uses {byteSize(total)}.</p>;
  }
  return (
    <p className={styles.warning} role="status">
      The history uses {byteSize(total)}. Deleting old tasks frees the space.
    </p>
  );
}

// Every past task, newest first; opening one replays it through the same trace view.
export function TasksView() {
  const agents = useAgents();
  const waiting = useWaitingSessions();
  const older = useApp((state) => state.olderTasks);
  const [loading, setLoading] = useState(false);
  const days = Map.groupBy(agents, (agent) => dayOf(agent.task.createdAt));

  const loadMore = async () => {
    setLoading(true);
    try {
      await loadOlderTasks();
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.page} aria-labelledby="tasks-title">
      <div className={styles.column}>
        <h1 id="tasks-title" className={styles.heading}>
          Tasks
        </h1>
        <StoreSize />
        {agents.length === 0 ? <p className={styles.size}>No tasks yet.</p> : null}
        {[...days].map(([day, dayAgents]) => (
          <section key={day} aria-label={day}>
            <h2 className={styles.day}>{day}</h2>
            <ul className={styles.list}>
              {dayAgents.map((agent) => (
                <TaskRow key={agent.taskId} agent={agent} waiting={waiting.has(agent.latest.id)} />
              ))}
            </ul>
          </section>
        ))}
        {older === undefined ? null : (
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Show older tasks"}
          </Button>
        )}
      </div>
    </section>
  );
}
