import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { clock, inTime } from "./limits.ts";
import styles from "./Usage.module.css";
import { continueElsewhere, type LimitStop, useLimitStops, useMinute } from "./use-usage.ts";

function Stop({ stop, now }: { stop: LimitStop; now: number }) {
  const harnessName = useApp(
    (state) =>
      state.harnesses.find((known) => known.harness === stop.agent.latest.options.harness)?.name ??
      stop.agent.latest.options.harness,
  );
  const [waitingUntil, setWaitingUntil] = useState<number>();
  const [busy, setBusy] = useState(false);
  const { agent, account, next, resetsAt } = stop;
  const accountName = `${harnessName} · ${account?.name ?? "Default"}`;
  const act = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await work();
      showToast(done);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={styles.stop}>
      <Avatar name={agent.name} colour={agent.colour} size={30} />
      <div className={styles.stopText}>
        <strong>{agent.name} stopped</strong>
        <span>
          {accountName} hit its plan limit.
          {resetsAt === undefined
            ? ""
            : ` It resets at ${clock(resetsAt, now)}, ${inTime(resetsAt, now)}.`}
        </span>
      </div>
      <div className={styles.stopActions}>
        {next === undefined ? null : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void act(() => continueElsewhere(stop), `${agent.name} carries on on ${next.name}`)
            }
          >
            Continue on {next.name}
          </Button>
        )}
        {resetsAt === undefined ? null : waitingUntil !== undefined ? (
          <span className={styles.muted}>Resumes at {clock(waitingUntil, now)}</span>
        ) : (
          <Button
            variant={next === undefined ? "primary" : "secondary"}
            disabled={busy}
            onClick={() =>
              void act(
                async () => {
                  await api.resumeAgentAt(agent.id, new Date(resetsAt).toISOString());
                  setWaitingUntil(resetsAt);
                },
                `${agent.name} resumes at ${clock(resetsAt, now)}`,
              )
            }
          >
            Resume at {clock(resetsAt, now)}
          </Button>
        )}
      </div>
    </li>
  );
}

// Agents stopped by a used-up plan, each with a way to carry on.
export function LimitStops({ title }: { title?: string }) {
  const stops = useLimitStops();
  const now = useMinute();
  if (stops.length === 0) return null;
  return (
    <section className={styles.stops} aria-label="Stopped at a plan limit">
      {title === undefined ? null : <h2 className={styles.toolName}>{title}</h2>}
      <ul className={styles.stopList}>
        {stops.map((stop) => (
          <Stop key={stop.agent.id} stop={stop} now={now} />
        ))}
      </ul>
    </section>
  );
}
