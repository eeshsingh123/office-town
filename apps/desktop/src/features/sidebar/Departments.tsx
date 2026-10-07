import { LoaderCircle } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { openChiefSettings, selectAgent } from "../office/office-state.ts";
import styles from "./Sidebar.module.css";

// It spins while one of its goals is at work.
function ChiefEntry() {
  const chiefId = useApp((state) => state.chiefId);
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) =>
        chiefId !== undefined && task.leadAgentId === chiefId && task.state === "working",
    ),
  );
  return (
    <button
      type="button"
      className={styles.nav}
      onClick={() => (chiefId === undefined ? openChiefSettings() : selectAgent(chiefId))}
    >
      {working ? (
        <LoaderCircle size={11} className={`${styles.chiefWorking} spin`} aria-label="Working" />
      ) : (
        <span className={styles.chiefMark} aria-hidden />
      )}
      Chief
      {chiefId === undefined ? <span className={styles.members}>Set up</span> : null}
    </button>
  );
}

// A dot marks one at work.
export function Departments() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const list = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const working = new Set(
    Object.values(tasks).flatMap(({ task, sessionIds }) => {
      const open = sessionIds.some((id) => {
        const session = sessions[id];
        return session !== undefined && isOpen(session);
      });
      return open && task.departmentId !== undefined ? [task.departmentId] : [];
    }),
  );
  return (
    <>
      <div className={styles.label}>Departments</div>
      <ChiefEntry />
      {list.map((department) => {
        const members = Object.values(agents).filter(
          (agent) => agent.departmentId === department.id,
        ).length;
        return (
          <button
            key={department.id}
            type="button"
            className={styles.nav}
            onClick={() => navigate({ name: "office", room: department.id })}
          >
            <span
              className={`${styles.dot} ${working.has(department.id) ? styles.dotWorking : ""}`}
              aria-hidden
            />
            {department.name}
            <span className={styles.members}>
              {members}
              <span className="visually-hidden"> members</span>
            </span>
          </button>
        );
      })}
    </>
  );
}
