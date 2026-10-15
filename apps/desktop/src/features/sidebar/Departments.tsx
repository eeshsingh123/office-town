import { ArrowRight, LoaderCircle, Network, Plus, Users } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import menu from "../../ui/Menu.module.css";
import styles from "./Sidebar.module.css";

// Shown once a chief exists; it spins while one of its goals is at work.
function ChiefEntry() {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const current = useApp((state) => state.view.name === "chief");
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) =>
        state.chiefId !== undefined &&
        task.leadAgentId === state.chiefId &&
        task.state === "working",
    ),
  );
  if (chief === undefined) return null;
  return (
    <button
      type="button"
      className={styles.nav}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate({ name: "chief" })}
    >
      {working ? (
        <LoaderCircle size={11} className={`${styles.chiefWorking} spin`} aria-label="Working" />
      ) : (
        <span className={styles.chiefMark} aria-hidden />
      )}
      <span className={styles.text}>{chief.name}</span>
      <span className={styles.members}>Chief</span>
    </button>
  );
}

// Until there is a chief, its place in the list offers one; it needs a department to plan for.
function ChiefCard() {
  const show = useApp(
    (state) => state.chiefId === undefined && Object.keys(state.departments).length > 0,
  );
  if (!show) return null;
  return (
    <div className={styles.teamCard}>
      <div className={styles.teamCardHead}>
        <span className={styles.teamCardIcon} aria-hidden>
          <Network size={13} />
        </span>
        <strong>Add a chief</strong>
      </div>
      <span className={styles.teamHint}>
        Give it one goal and it splits the work across your departments.
      </span>
      <button type="button" onClick={() => navigate({ name: "chief" })}>
        Set up a chief
        <ArrowRight size={14} aria-hidden />
      </button>
    </div>
  );
}

// Adds a department, or the chief while there is none.
function AddMenu() {
  const hasChief = useApp((state) => state.chiefId !== undefined);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={styles.labelButton} aria-label="Add to your team">
          <Plus size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
          <DropdownMenu.Item
            className={`${menu.item} ${styles.addItem}`}
            onSelect={() => navigate({ name: "new-department" })}
          >
            <Users size={15} aria-hidden />
            <span>
              <strong>New department</strong>
              <span className={styles.addHint}>A lead and its people</span>
            </span>
          </DropdownMenu.Item>
          {hasChief ? null : (
            <DropdownMenu.Item
              className={`${menu.item} ${styles.addItem}`}
              onSelect={() => navigate({ name: "chief" })}
            >
              <Network size={15} aria-hidden />
              <span>
                <strong>Add a chief</strong>
                <span className={styles.addHint}>Plans goals across departments</span>
              </span>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
      <div className={`${styles.label} ${styles.labelRow}`}>
        Your team
        {list.length === 0 ? null : <AddMenu />}
      </div>
      <ChiefEntry />
      <ChiefCard />
      {list.length === 0 ? (
        <div className={styles.teamCard}>
          <strong>Build your team</strong>
          <span className={styles.teamHint}>
            Start with one department: a lead and the people it hands work to.
          </span>
          <button type="button" onClick={() => navigate({ name: "new-department" })}>
            Build a department
            <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      ) : null}
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
