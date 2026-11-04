import { Copy, LayoutGrid, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { agentsInTask } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { deleteTask } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { confirmed, copyText, type MenuAction, type MenuContent } from "../../ui/ActionMenu.tsx";
import { taskName } from "../../ui/format.ts";
import { selectAgent, selectRoom } from "../office/office-state.ts";

// A task's row in Tasks and in the sidebar: its "…" button and its right-click share this list.
export function taskMenu(taskId: string): MenuContent | undefined {
  const known = useApp.getState();
  const task = known.tasks[taskId]?.task;
  if (task === undefined) return undefined;
  const agents = agentsInTask(known, taskId);
  const running = agents.some((agent) => isOpen(agent.latest));
  const lead = agents[0];
  const department =
    task.departmentId === undefined ? undefined : known.departments[task.departmentId];

  const actions: MenuAction[] = [
    {
      label: "Open",
      icon: SquareArrowOutUpRight,
      run: () => navigate({ name: "task", taskId }),
    },
  ];
  const showInOffice =
    department !== undefined
      ? () => selectRoom(department.id)
      : lead !== undefined
        ? () => selectAgent(lead.id)
        : undefined;
  if (showInOffice !== undefined) {
    actions.push({ label: "Show in office", icon: LayoutGrid, run: showInOffice });
  }
  actions.push(
    { label: "Copy title", icon: Copy, run: () => copyText(taskName(task)) },
    confirmed(
      {
        label: "Delete task",
        icon: Trash2,
        disabled: running,
        ...(running ? { note: "Stop its agents first" } : {}),
      },
      {
        title: "Delete this task?",
        description: "Its history is deleted. Files the agent made stay in the folder.",
        confirmLabel: "Delete task",
        run: () => deleteTask(taskId),
      },
    ),
  );
  return { actions };
}
