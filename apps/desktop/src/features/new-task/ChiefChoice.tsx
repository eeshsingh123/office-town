import { Clock } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { useAiSummary } from "../profiles/AiLine.tsx";
import { useChiefGoals } from "../work/use-chief-goals.ts";
import styles from "./NewTaskView.module.css";

export function useChief() {
  const chiefId = useApp((state) => state.chiefId);
  const record = useApp((state) => (chiefId === undefined ? undefined : state.agents[chiefId]));
  const { current, queue } = useChiefGoals(chiefId);
  if (record === undefined) return undefined;
  const busy = current !== undefined && current.state !== "ended";
  return { record, busy, current, queue };
}

export function ChiefChoice() {
  const chief = useChief();
  const departments = useApp((state) => Object.keys(state.departments).length);
  const summary = useAiSummary(chief?.record.settings);
  if (chief === undefined) {
    return (
      <section className={styles.callout}>
        <div>
          <strong>You don't have a chief yet</strong>
          <p className={page.hint}>
            The chief turns a big goal into a plan for your departments. Setting it up takes about
            two minutes.
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate({ name: "chief" })}>
          Set up your chief
        </Button>
      </section>
    );
  }
  const { record, busy, current, queue } = chief;
  const last = queue.at(-1);
  return (
    <section className={styles.callout}>
      <Avatar name={record.name} colour={record.colour} size={40} />
      <div className={styles.calloutText}>
        <strong>{record.name}</strong>
        <span className={page.hint}>
          Thinks with {summary}. Can hand work to{" "}
          {departments === 1 ? "1 department" : `${departments} departments`}.
        </span>
        {busy && current !== undefined ? (
          <span className={styles.queueNote}>
            <Clock size={14} aria-hidden />
            Working on "{taskTitle(current.prompt)}". This goal waits its turn
            {last === undefined ? "" : ` after "${taskTitle(last.prompt)}"`}.
          </span>
        ) : null}
      </div>
      <Button variant="ghost" onClick={() => navigate({ name: "chief" })}>
        Open
      </Button>
    </section>
  );
}
