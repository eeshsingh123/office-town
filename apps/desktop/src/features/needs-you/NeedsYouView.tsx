import type { UserRequestEvent } from "@office-town/contract";
import { useLevel, useSessionAgent } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { RequestContext } from "../requests/RequestContext.tsx";
import styles from "./NeedsYouView.module.css";

function LevelNote({ event }: { event: UserRequestEvent }) {
  const agent = useSessionAgent(event.sessionId);
  const level = useLevel(agent?.record);
  const departmentId = agent?.record.departmentId;
  if (event.type !== "permission.requested") return null;
  return (
    <p className={styles.levelNote}>
      Your setting "{AUTONOMY[level].label}" asks you before this.{" "}
      {departmentId === undefined ? null : (
        <button
          type="button"
          className={styles.link}
          onClick={() => navigate({ name: "department", departmentId })}
        >
          Change the level in the department's settings
        </button>
      )}
    </p>
  );
}

interface Group {
  key: string;
  name: string;
  detail: string;
  requests: WaitingRequest[];
}

// Grouped by department, oldest first. What a level allows never reaches this list.
export function NeedsYouView() {
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const requests = Object.values(waiting).sort((a, b) => a.position - b.position);
  const groups = new Map<string, Group>();
  for (const request of requests) {
    const agentId = sessions[request.event.sessionId]?.agentId;
    const departmentId = agentId === undefined ? undefined : agents[agentId]?.departmentId;
    const department = departmentId === undefined ? undefined : departments[departmentId];
    const key = department?.id ?? "floor";
    const group = groups.get(key) ?? {
      key,
      name: department?.name ?? "Open floor",
      detail: department === undefined ? "" : AUTONOMY[department.autonomy].label,
      requests: [],
    };
    group.requests.push(request);
    groups.set(key, group);
  }

  return (
    <section className={styles.page} aria-labelledby="needs-you-title">
      <div className={styles.column}>
        <h1 id="needs-you-title" className={styles.title}>
          Needs you
        </h1>
        <p className={styles.lead}>
          {requests.length === 0
            ? "No agent is waiting for you."
            : `${requests.length === 1 ? "1 request" : `${requests.length} requests`}, grouped by department, oldest first. What a department may do without asking never reaches this list.`}
        </p>
        {[...groups.values()].map((group) => (
          <section key={group.key} aria-label={group.name}>
            <h2 className={styles.group}>
              <span
                className={`${styles.dot} ${group.key === "floor" ? styles.floor : ""}`}
                aria-hidden
              />
              {group.name}
              <span className={styles.groupDetail}>
                {[group.detail, `${group.requests.length} waiting`].filter(Boolean).join(" · ")}
              </span>
            </h2>
            {group.requests.map(({ event }) => (
              <RequestCard
                key={event.id}
                event={event}
                context={
                  <>
                    <RequestContext sessionId={event.sessionId} />
                    <LevelNote event={event} />
                  </>
                }
              />
            ))}
          </section>
        ))}
        <p className={styles.note}>
          When the window is closed, Office Town keeps running in the tray and shows a notification
          when an agent needs you.
        </p>
      </div>
    </section>
  );
}
