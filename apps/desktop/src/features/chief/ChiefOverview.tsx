import { ArrowUpRight } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import office from "../office/Office.module.css";
import {
  Facts,
  PanelHeader,
  PanelSection,
  PanelSettings,
  StateChip,
} from "../office/SidePanel.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { useChiefGoals } from "../work/use-chief-goals.ts";
import styles from "./Chief.module.css";

function useChiefWaiting(chiefId: string) {
  return useApp((state) =>
    Object.values(state.waiting).find(
      ({ event }) => state.sessions[event.sessionId]?.agentId === chiefId,
    ),
  );
}

export function ChiefHeader({ chiefId }: { chiefId: string }) {
  const chief = useApp((state) => state.agents[chiefId]);
  const { current } = useChiefGoals(chiefId);
  const waiting = useChiefWaiting(chiefId);
  if (chief === undefined) return null;
  const working = current !== undefined && current.state !== "ended";
  return (
    <PanelHeader
      picture={<Avatar name={chief.name} colour={chief.colour} size={36} />}
      title={chief.name}
      subtitle="Chief"
      status={
        waiting !== undefined ? (
          <StateChip state="waiting" />
        ) : working ? (
          <StateChip state="working" />
        ) : undefined
      }
      actions={
        <PanelSettings
          label="Chief settings"
          onClick={() => navigate({ name: "chief", edit: true })}
        />
      }
    />
  );
}

export function ChiefNow({ chiefId }: { chiefId: string }) {
  const chief = useApp((state) => state.agents[chiefId]);
  const summary = useModelLine(chief?.settings);
  const { current, queue } = useChiefGoals(chiefId);
  const waiting = useChiefWaiting(chiefId);
  if (chief === undefined) return null;
  const working = current !== undefined && current.state !== "ended";
  return (
    <>
      {waiting === undefined ? null : <RequestCard key={waiting.event.id} event={waiting.event} />}
      <PanelSection title="Working on">
        {working ? (
          <button
            type="button"
            className={office.taskLink}
            onClick={() => navigate({ name: "task", taskId: current.id })}
          >
            {taskTitle(current.prompt)}
            <ArrowUpRight size={14} aria-hidden />
          </button>
        ) : (
          <p className={styles.quiet}>No goal in progress</p>
        )}
      </PanelSection>
      {queue.length === 0 ? null : (
        <PanelSection title={`Queue · ${queue.length}`}>
          <ol className={styles.panelQueue}>
            {queue.map((task) => (
              <li key={task.id}>{taskTitle(task.prompt)}</li>
            ))}
          </ol>
        </PanelSection>
      )}
      <PanelSection title="Runs on">
        <Facts facts={[summary]} />
      </PanelSection>
    </>
  );
}

export function ChiefFooter({ chiefId }: { chiefId: string }) {
  const { current } = useChiefGoals(chiefId);
  if (current === undefined || current.state === "ended") {
    return (
      <Button variant="primary" onClick={() => navigate({ name: "chief" })}>
        Give the chief a goal
      </Button>
    );
  }
  return (
    <Button variant="primary" onClick={() => navigate({ name: "task", taskId: current.id })}>
      Open goal
    </Button>
  );
}
