import type { StoppedTask } from "@office-town/contract";
import { CircleStop, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { onChange, track } from "../../store/live.ts";
import { Button } from "../../ui/Button.tsx";
import { taskName } from "../../ui/format.ts";
import { showToast } from "../../ui/Toast.tsx";
import usage from "../usage/Usage.module.css";
import styles from "./StoppedTasks.module.css";

// Read again once things settle after a burst of changes.
const REREAD_MS = 300;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// What holds a row back, or the wait of its resume; nothing once it can start.
function detailOf(row: StoppedTask): string | undefined {
  if (row.reason !== undefined) return row.reason;
  if (row.entry === undefined) return undefined;
  if (row.entry.state === "waiting") return row.entry.reason ?? "Waiting to start";
  return row.entry.reason;
}

const canResume = (row: StoppedTask) => row.reason === undefined && row.entry === undefined;

function useStoppedTasks(): [StoppedTask[], (rows: StoppedTask[]) => void] {
  const [rows, setRows] = useState<StoppedTask[]>([]);
  // Work is cut off only when the core stops, so an empty card is read again only once it is back.
  const live = useApp((state) => state.connection === "live");
  const shown = useRef(false);
  const keep = (tasks: StoppedTask[]) => {
    shown.current = tasks.length > 0;
    setRows(tasks);
  };
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      api
        .listStoppedTasks()
        .then(({ tasks }) => {
          shown.current = tasks.length > 0;
          setRows(tasks);
          // An older task may not be loaded yet.
          const known = useApp.getState().tasks;
          for (const { taskId } of tasks) if (known[taskId] === undefined) void track(taskId);
        })
        .catch((failure: unknown) => console.error("Could not read the stopped tasks.", failure));
    };
    read();
    const stop = onChange((change) => {
      if (!shown.current) return;
      if (change.type !== "queue" && change.type !== "task" && change.type !== "task.deleted") {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(read, REREAD_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [live]);
  return [rows, keep];
}

// "3 tasks stopped when Office Town closed." Nothing resumes on its own; the user picks (D-122).
export function StoppedTasksCard() {
  const [rows, setRows] = useStoppedTasks();
  const tasks = useApp((state) => state.tasks);
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;

  const nameOf = (taskId: string) => {
    const task = tasks[taskId]?.task;
    return task === undefined ? "A task" : taskName(task);
  };
  const resumable = rows.filter(canResume);
  const resume = async (taskIds: string[]) => {
    setBusy(true);
    try {
      setRows((await api.resumeStoppedTasks(taskIds)).tasks);
      setChoosing(false);
      setPicked(new Set());
    } catch (failure) {
      showToast(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    try {
      await api.closeStoppedTasks();
      setRows([]);
    } catch (failure) {
      showToast(errorText(failure));
    }
  };
  const toggle = (taskId: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(taskId);
    else next.delete(taskId);
    setPicked(next);
  };
  const listed = choosing || rows.some((row) => detailOf(row) !== undefined);
  const count = rows.length;

  return (
    <section className={usage.stops} aria-label="Stopped when Office Town closed">
      <div className={`${usage.stop} ${styles.card}`}>
        <CircleStop size={22} aria-hidden="true" />
        <div className={usage.stopText}>
          <strong>
            {count} {count === 1 ? "task" : "tasks"} stopped when Office Town closed.
          </strong>
          {listed ? null : <span>{rows.map((row) => nameOf(row.taskId)).join(", ")}</span>}
        </div>
        <div className={usage.stopActions}>
          <Button
            variant="primary"
            disabled={busy || resumable.length === 0}
            onClick={() => void resume(resumable.map((row) => row.taskId))}
          >
            Resume all
          </Button>
          <Button
            disabled={busy || resumable.length === 0}
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            Choose
          </Button>
          <Button variant="ghost" icon aria-label="Close" onClick={() => void close()}>
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        {listed ? (
          <ul className={styles.rows}>
            {rows.map((row) => {
              const detail = detailOf(row);
              return (
                <li key={row.taskId} className={styles.row}>
                  {choosing ? (
                    <input
                      type="checkbox"
                      aria-label={`Resume ${nameOf(row.taskId)}`}
                      disabled={!canResume(row)}
                      checked={picked.has(row.taskId)}
                      onChange={(event) => toggle(row.taskId, event.target.checked)}
                    />
                  ) : null}
                  <button
                    type="button"
                    className={styles.name}
                    onClick={() => navigate({ name: "task", taskId: row.taskId })}
                  >
                    {nameOf(row.taskId)}
                  </button>
                  {detail === undefined ? null : <span className={styles.detail}>{detail}</span>}
                </li>
              );
            })}
          </ul>
        ) : null}
        {choosing ? (
          <div className={styles.chosen}>
            <Button
              variant="primary"
              disabled={busy || picked.size === 0}
              onClick={() => void resume([...picked])}
            >
              Resume ({picked.size})
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
