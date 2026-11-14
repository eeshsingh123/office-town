import { navigate, useApp } from "../../store/app-store.ts";
import { TaskStatusIcon } from "../tasks/TaskStatusIcon.tsx";
import { useNow, useTaskItems } from "../tasks/use-items.ts";
import team from "./TeamTaskView.module.css";

// A chief's goal lists the parts it planned, so its page shows more than the chief (a3-12). A part
// not started yet has no page to open.
export function GoalParts({ taskId }: { taskId: string }) {
  const now = useNow();
  const goal = useTaskItems(now).find((item) => item.id === taskId);
  const departments = useApp((state) => state.departments);
  if (goal === undefined || goal.parts.length === 0) return null;
  return (
    <>
      <span className={`${team.label} ${team.visiting}`}>Parts</span>
      {goal.parts.map((part) => (
        <button
          key={part.id}
          type="button"
          className={team.part}
          disabled={part.task === undefined}
          onClick={() => {
            if (part.task !== undefined) navigate({ name: "task", taskId: part.task.id });
          }}
        >
          <TaskStatusIcon status={part.status} size={13} />
          <span className={team.partText}>
            <span className={team.partTitle}>{part.title}</span>
            <span className={team.model}>
              {departments[part.team]?.name ??
                (part.task === undefined ? "Not started" : "Assistant")}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}
