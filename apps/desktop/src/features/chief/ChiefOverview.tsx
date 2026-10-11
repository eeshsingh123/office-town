import { Settings } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { useModelLine } from "../profiles/model-line.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { useChiefGoals } from "../work/use-chief-goals.ts";
import styles from "./Chief.module.css";

export function ChiefOverview({ chiefId }: { chiefId: string }) {
  const chief = useApp((state) => state.agents[chiefId]);
  const summary = useModelLine(chief?.settings);
  const { current, queue } = useChiefGoals(chiefId);
  const waiting = useApp((state) =>
    Object.values(state.waiting).find(
      ({ event }) => state.sessions[event.sessionId]?.agentId === chiefId,
    ),
  );
  if (chief === undefined) return null;
  const working = current !== undefined && current.state !== "ended";
  return (
    <>
      <div className={styles.head}>
        <Avatar name={chief.name} colour={chief.colour} size={36} />
        <div className={styles.headText}>
          <strong>{chief.name}</strong>
          <span>Chief</span>
        </div>
        <Button variant="ghost" onClick={() => navigate({ name: "chief", edit: true })}>
          <Settings size={14} aria-hidden />
          Settings
        </Button>
      </div>
      <dl className={styles.facts}>
        <dt>Model</dt>
        <dd>{summary}</dd>
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
      {waiting === undefined ? null : <RequestCard key={waiting.event.id} event={waiting.event} />}
    </>
  );
}
