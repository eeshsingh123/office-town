import { Plus } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { teamLine } from "../new-task/TeamChoice.tsx";
import { selectRoom } from "../office/office-state.ts";
import styles from "./Chief.module.css";

// The departments a chief can hand work to, each one click from its room.
export function DepartmentList() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const sorted = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={styles.departments}>
      {sorted.map((department) => {
        const lead = agents[department.leadAgentId];
        const workers =
          Object.values(agents).filter((agent) => agent.departmentId === department.id).length - 1;
        return (
          <button
            key={department.id}
            type="button"
            className={styles.department}
            onClick={() => selectRoom(department.id)}
          >
            <Avatar name={department.name} colour={lead?.colour ?? "#4F5D75"} size={32} />
            <span className={styles.departmentText}>
              <strong>{department.name}</strong>
              <span>{teamLine(workers)}</span>
            </span>
          </button>
        );
      })}
      <Button onClick={() => navigate({ name: "new-department" })}>
        <Plus size={14} aria-hidden />
        Build a department
      </Button>
    </div>
  );
}
