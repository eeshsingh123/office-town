import { ArrowRight, LoaderCircle, Network, Plus, Users } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { ContextMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import menu from "../../ui/Menu.module.css";
import { departmentMenu } from "../departments/department-menu.tsx";
import { selectRoom } from "../office/office-state.ts";
import type { RowStatus } from "../tasks/task-list.ts";
import { useNow, useTaskItems } from "../tasks/use-items.ts";
import styles from "./Sidebar.module.css";

// Past this many, the list shows a box to find one and a link to all of them on Team.
const SHOWN = 8;

type DepartmentState = Extract<RowStatus, "needs" | "working" | "review">;

const STATE_LABELS: Record<DepartmentState, string> = {
  needs: "Needs you",
  working: "Working",
  review: "To review",
};

// What a department is doing, from its tasks' statuses: asking wins over working over review.
function useDepartmentStates(): Map<string, DepartmentState> {
  const items = useTaskItems(useNow());
  const states = new Map<string, DepartmentState>();
  for (const status of ["review", "working", "needs"] as const) {
    for (const item of items) if (item.status === status) states.set(item.team, status);
  }
  return states;
}

function StateMark({ state }: { state: DepartmentState | undefined }) {
  if (state === undefined) return null;
  const label = STATE_LABELS[state];
  if (state === "working") {
    return <LoaderCircle size={12} className={`${styles.stateWorking} spin`} aria-label={label} />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={`${styles.stateDot} ${state === "needs" ? styles.stateNeeds : styles.stateReview}`}
    />
  );
}

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
      <Avatar name={chief.name} colour={chief.colour} size={18} />
      <span className={styles.text}>{chief.name}</span>
      <span className={styles.members}>Chief</span>
      {working ? (
        <LoaderCircle size={12} className={`${styles.stateWorking} spin`} aria-label="Working" />
      ) : null}
    </button>
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

// Each department in its lead's colour, with what it is doing and a one-click New task.
export function Departments() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const room = useApp((state) => (state.view.name === "office" ? state.view.room : undefined));
  const states = useDepartmentStates();
  const [find, setFind] = useState("");
  const all = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const words = find.trim().toLowerCase();
  const matching = all.filter((department) => department.name.toLowerCase().includes(words));
  const shown = matching.slice(0, SHOWN);
  return (
    <>
      <div className={`${styles.label} ${styles.labelRow}`}>
        Departments
        {all.length === 0 ? null : <AddMenu />}
      </div>
      <ChiefEntry />
      {all.length === 0 ? (
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
      {all.length > SHOWN ? (
        <input
          className={styles.find}
          type="search"
          value={find}
          placeholder="Find a department"
          aria-label="Find a department"
          onChange={(event) => setFind(event.target.value)}
        />
      ) : null}
      {shown.map((department) => {
        const lead = agents[department.leadAgentId];
        return (
          <ContextMenu key={department.id} menu={() => departmentMenu(department.id)}>
            <div className={styles.department}>
              <button
                type="button"
                className={styles.nav}
                aria-current={room === department.id ? "page" : undefined}
                onClick={() => selectRoom(department.id)}
              >
                <Avatar name={department.name} colour={lead?.colour ?? "#8f897f"} size={18} />
                <span className={styles.text}>{department.name}</span>
                <StateMark state={states.get(department.id)} />
              </button>
              <button
                type="button"
                className={styles.departmentNew}
                aria-label={`New task for ${department.name}`}
                title="New task"
                onClick={() =>
                  navigate({ name: "new-task", who: "team", departmentId: department.id })
                }
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
          </ContextMenu>
        );
      })}
      {all.length > SHOWN ? (
        <button type="button" className={styles.all} onClick={() => navigate({ name: "team" })}>
          All {all.length} departments
        </button>
      ) : null}
    </>
  );
}
