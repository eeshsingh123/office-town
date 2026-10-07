import { Settings } from "lucide-react";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { openChiefSettings } from "../office/office-state.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { useChiefGoals } from "../work/use-chief-goals.ts";
import styles from "./Chief.module.css";

// The chief at a glance: how it runs, its goal, its queue and any request it waits on (D-49).
export function ChiefOverview({ chiefId }: { chiefId: string }) {
  const chief = useApp((state) => state.agents[chiefId]);
  const harness = useHarnessName(chief?.settings.harness ?? "");
  const { current, queue } = useChiefGoals(chiefId);
  const waiting = useApp((state) =>
    Object.values(state.waiting).find(
      ({ event }) => state.sessions[event.sessionId]?.agentId === chiefId,
    ),
  );
  if (chief === undefined) return null;
  const { model, effort } = chief.settings;
  const working = current !== undefined && current.state !== "ended";
  return (
    <>
      <div className={styles.head}>
        <Avatar name={chief.name} colour={chief.colour} size={36} />
        <div className={styles.headText}>
          <strong>{chief.name}</strong>
          <span>Chief</span>
        </div>
        <Button variant="ghost" onClick={() => openChiefSettings()}>
          <Settings size={14} aria-hidden />
          Settings
        </Button>
      </div>
      <dl className={styles.facts}>
        <dt>Harness</dt>
        <dd>{[harness, model, effort].filter((part) => part !== undefined).join(" · ")}</dd>
        <dt>Working on</dt>
        <dd>
          {working ? (
            <button
              type="button"
              className={styles.taskLink}
              onClick={() => navigate({ name: "task", taskId: current.id })}
            >
              {taskTitle(current.prompt)}
            </button>
          ) : (
            "No goal in progress"
          )}
        </dd>
        <dt>Queue</dt>
        <dd>
          {queue.length === 0
            ? "Empty"
            : `${queue.length === 1 ? "1 goal" : `${queue.length} goals`}: ${taskTitle(queue[0]?.prompt ?? "")}`}
        </dd>
      </dl>
      {waiting === undefined ? null : <RequestCard event={waiting.event} />}
      <p className={styles.note}>
        The chief plans and messages leads. It does not change departments' files.
      </p>
    </>
  );
}
