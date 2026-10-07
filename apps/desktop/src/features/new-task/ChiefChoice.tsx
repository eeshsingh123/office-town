import { Clock, Settings } from "lucide-react";
import { useApp, useHarnessName } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { openChiefSettings } from "../office/office-state.ts";
import { useChiefGoals } from "../work/use-chief-goals.ts";
import styles from "./NewTaskView.module.css";

export function ChiefChoice() {
  const chiefId = useApp((state) => state.chiefId);
  const chief = useApp((state) => (chiefId === undefined ? undefined : state.agents[chiefId]));
  const harness = useHarnessName(chief?.settings.harness ?? "");
  const { current, queue } = useChiefGoals(chiefId);
  if (chief === undefined) {
    return (
      <div className={styles.where}>
        <div className={styles.chief}>
          <span>
            <span className={styles.choiceName}>No chief yet</span>
            <br />
            <span className={styles.hint}>
              The chief splits a goal across departments and sets their order. Set it up once.
            </span>
          </span>
          <Button variant="primary" onClick={() => openChiefSettings()}>
            Set up the chief
          </Button>
        </div>
      </div>
    );
  }
  const busy = current !== undefined && current.state !== "ended";
  const last = queue.at(-1);
  return (
    <div className={styles.where}>
      <div className={styles.chief}>
        <Avatar name={chief.name} colour={chief.colour} size={28} />
        <span className={styles.chiefText}>
          <span className={styles.choiceName}>{chief.name}</span>
          <span className={styles.hint}>
            {[harness, chief.settings.model, chief.settings.effort]
              .filter((part) => part !== undefined)
              .join(" · ")}
            {busy && queue.length > 0
              ? ` · ${queue.length === 1 ? "1 goal" : `${queue.length} goals`} queued`
              : ""}
          </span>
        </span>
        <Button variant="ghost" onClick={() => openChiefSettings()}>
          <Settings size={14} aria-hidden />
          Settings
        </Button>
      </div>
      {busy ? (
        <p className={styles.queueNote}>
          <Clock size={14} aria-hidden />
          The chief is working on "{taskTitle(current.prompt)}". This goal waits in its queue
          {last === undefined ? "" : ` after "${taskTitle(last.prompt)}"`} and starts when{" "}
          {last === undefined ? "that is" : "those are"} done.
        </p>
      ) : null}
    </div>
  );
}
