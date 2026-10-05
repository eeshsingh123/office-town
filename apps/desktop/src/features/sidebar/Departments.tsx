import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import styles from "./Sidebar.module.css";

// The departments the user keeps, each with how many members it has; a dot marks one at work.
export function Departments() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const list = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  if (list.length === 0) return null;
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
