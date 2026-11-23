import type { TaskRecord } from "@office-town/contract";
import { CalendarClock } from "lucide-react";
import { navigate } from "../../store/app-store.ts";
import { useAutomation } from "../../store/automations.ts";
import styles from "./Automations.module.css";

// Who started a task, as its own chip beside the status: "Weekly posts plan · Run 15". A task the
// user started shows none; a deleted automation's name stays, without a link.
export function OriginChip({ task }: { task: TaskRecord }) {
  const origin = task.origin?.kind === "automation" ? task.origin : undefined;
  const automation = useAutomation(origin?.automationId ?? "");
  if (origin === undefined) return null;
  const text = `${automation?.name ?? origin.name} · Run ${origin.run}`;
  if (automation === undefined) {
    return (
      <span className={styles.chip} title="Started by an automation that was deleted">
        <CalendarClock size={13} aria-hidden />
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.chipLink}`}
      title="Started by this automation"
      onClick={() => navigate({ name: "automation", automationId: origin.automationId })}
    >
      <CalendarClock size={13} aria-hidden />
      {text}
    </button>
  );
}
