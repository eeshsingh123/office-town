import type { TaskPause, TaskRecord } from "@office-town/contract";
import { Pause } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { showToast } from "../../ui/Toast.tsx";
import { accountName, clock, inTime } from "./limits.ts";
import styles from "./Usage.module.css";
import { useMinute } from "./use-usage.ts";

interface PausedAccount {
  accountId: string;
  pause: TaskPause;
  tasks: TaskRecord[];
}

function pausedAccounts(tasks: readonly TaskRecord[]): PausedAccount[] {
  const byAccount = new Map<string, PausedAccount>();
  for (const task of tasks) {
    const { paused } = task;
    if (paused === undefined) continue;
    const known = byAccount.get(paused.accountId);
    if (known === undefined)
      byAccount.set(paused.accountId, {
        accountId: paused.accountId,
        pause: paused,
        tasks: [task],
      });
    else known.tasks.push(task);
  }
  return [...byAccount.values()];
}

function Paused({ paused, now }: { paused: PausedAccount; now: number }) {
  const { accountId, pause, tasks } = paused;
  const accounts = useApp((state) => state.accounts);
  const harness =
    accounts.find((account) => account.id === accountId)?.harness ??
    accountId.split("@")[0] ??
    accountId;
  const harnessName = useApp(
    (state) => state.harnesses.find((known) => known.harness === harness)?.name ?? harness,
  );
  const [busy, setBusy] = useState(false);
  const resetsAt = pause.resetsAt === undefined ? undefined : Date.parse(pause.resetsAt);
  const resumeAt = pause.resumeAt === undefined ? undefined : Date.parse(pause.resumeAt);
  const resume = async (at: number | undefined, done: string) => {
    setBusy(true);
    try {
      await api.resumePaused(accountId, at === undefined ? undefined : new Date(at).toISOString());
      showToast(done);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const names = tasks.map((task) => taskTitle(task.prompt)).join(", ");
  return (
    <li className={styles.stop}>
      <Pause size={22} aria-hidden="true" />
      <div className={styles.stopText}>
        <strong>
          Paused at {Math.round(pause.usedFraction * 100)}% of the {pause.window} window
        </strong>
        <span>
          {accountName(accounts, harnessName, accountId)}: {names}.
          {resetsAt === undefined
            ? ""
            : ` It resets at ${clock(resetsAt, now)}, ${inTime(resetsAt, now)}.`}
        </span>
      </div>
      <div className={styles.stopActions}>
        {resumeAt !== undefined ? (
          <span className={styles.muted}>Resumes at {clock(resumeAt, now)}</span>
        ) : resetsAt === undefined ? null : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void resume(resetsAt, `Resumes at ${clock(resetsAt, now)}`)}
          >
            Resume at {clock(resetsAt, now)}
          </Button>
        )}
        <Button
          variant={resumeAt === undefined && resetsAt !== undefined ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => void resume(undefined, "Carrying on now")}
        >
          Resume now
        </Button>
      </div>
    </li>
  );
}

// Work paused once its account passed 95% of a usage window, until the user says (D-72).
export function UsagePauses({ title }: { title?: string }) {
  const entries = useApp((state) => state.tasks);
  const now = useMinute();
  const paused = useMemo(
    () => pausedAccounts(Object.values(entries).map((entry) => entry.task)),
    [entries],
  );
  if (paused.length === 0) return null;
  return (
    <section className={styles.stops} aria-label="Paused near a plan limit">
      {title === undefined ? null : <h2 className={styles.toolName}>{title}</h2>}
      <ul className={styles.stopList}>
        {paused.map((one) => (
          <Paused key={one.accountId} paused={one} now={now} />
        ))}
      </ul>
    </section>
  );
}
