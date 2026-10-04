import { useApp } from "../../store/app-store.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { RequestContext } from "../requests/RequestContext.tsx";
import styles from "./NeedsYouView.module.css";

// Every request waiting for the user, across all agents, oldest first (D-10).
export function NeedsYouView() {
  const waiting = useApp((state) => state.waiting);
  const requests = Object.values(waiting).sort((a, b) => a.position - b.position);
  return (
    <section className={styles.page} aria-labelledby="needs-you-title">
      <div className={styles.column}>
        <h1 id="needs-you-title" className={styles.title}>
          Needs you
        </h1>
        <p className={styles.lead}>
          {requests.length === 0
            ? "No agent is waiting for you."
            : `${requests.length === 1 ? "1 agent is" : `${requests.length} agents are`} waiting for an answer. Oldest first.`}
        </p>
        {requests.map(({ event }) => (
          <RequestCard
            key={event.id}
            event={event}
            context={<RequestContext sessionId={event.sessionId} />}
          />
        ))}
        <p className={styles.note}>
          When the window is closed, Office Town keeps running in the tray and shows a notification
          when an agent needs you.
        </p>
      </div>
    </section>
  );
}
