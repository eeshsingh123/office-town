import type { AutomationRecord } from "@office-town/contract";
import { navigate } from "../../store/app-store.ts";
import { useAutomations } from "../../store/automations.ts";
import { Button } from "../../ui/Button.tsx";
import home from "../home/Home.module.css";
import styles from "./Automations.module.css";
import { AutomationStatus, useWhenText, WhoAvatar } from "./parts.tsx";
import { stateOf } from "./words.ts";

const SHOWN = 4;

// What needs the user first: paused, missed runs, a run waiting on them.
function needsYou(automation: AutomationRecord): boolean {
  const state = stateOf(automation);
  return state === "paused" || state === "needs" || automation.latestRun?.missed !== undefined;
}

function Row({ automation }: { automation: AutomationRecord }) {
  const when = useWhenText(automation);
  const missed = automation.latestRun?.missed;
  return (
    <li>
      <button
        type="button"
        className={home.row}
        onClick={() => navigate({ name: "automation", automationId: automation.id })}
      >
        <WhoAvatar task={automation.task} size={20} />
        <span className={home.rowText}>
          <span className={home.rowName}>{automation.name}</span>
          <span className={home.rowLine}>
            {missed !== undefined && automation.latestRun?.status === "skipped"
              ? (automation.latestRun.reason ?? when)
              : (automation.paused?.reason ?? when)}
          </span>
        </span>
        <span className={styles.status}>
          <AutomationStatus automation={automation} />
        </span>
      </button>
    </li>
  );
}

// Home's small card, once one exists: what needs you first, else the next runs.
export function AutomationsCard() {
  const automations = useAutomations();
  if (automations === undefined || automations.length === 0) return null;
  const waiting = automations.filter(needsYou);
  const next = automations
    .filter((one) => !needsYou(one) && one.nextRunAt !== undefined)
    .toSorted((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""));
  const shown = [...waiting, ...next].slice(0, SHOWN);
  return (
    <section className={home.card} aria-labelledby="automations-card-title">
      <h2 id="automations-card-title" className={home.cardTitle}>
        Automations
      </h2>
      {shown.length === 0 ? (
        <p className={home.rowLine}>No run is coming up.</p>
      ) : (
        <ul className={home.list}>
          {shown.map((automation) => (
            <Row key={automation.id} automation={automation} />
          ))}
        </ul>
      )}
      {automations.length > shown.length ? (
        <Button variant="ghost" onClick={() => navigate({ name: "automations" })}>
          All automations
        </Button>
      ) : null}
    </section>
  );
}
