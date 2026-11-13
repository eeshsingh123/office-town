import {
  CircleCheck,
  Copy,
  Eye,
  LayoutGrid,
  MessageSquare,
  Play,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { api } from "../../api/client.ts";
import { agentsInTask } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { deleteTask, track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { markDone, openReview } from "../../store/reviewers.ts";
import { confirmed, copyText, type MenuAction, type MenuContent } from "../../ui/ActionMenu.tsx";
import { taskName } from "../../ui/format.ts";
import { selectAgent, selectRoom } from "../office/office-state.ts";
import { statusOfTask } from "./task-list.ts";

// A team picks up where it was cut off; a solo agent is asked to go on in its own conversation.
export async function continueWork(taskId: string): Promise<void> {
  const known = useApp.getState();
  const task = known.tasks[taskId]?.task;
  const solo = agentsInTask(known, taskId)[0];
  if (task?.leadAgentId !== undefined) await api.continueTask(taskId, "");
  else if (solo !== undefined)
    await api.messageAgent(solo.id, "Continue where you stopped.", taskId);
  await track(taskId);
}

// A task's menu in Tasks, the sidebar and on the Board, with only what its status allows. The
// Board adds Follow up, which opens the chat it already shows beside it.
export function taskMenu(taskId: string, followUp?: () => void): MenuContent | undefined {
  const known = useApp.getState();
  const task = known.tasks[taskId]?.task;
  const status = statusOfTask(known, taskId);
  if (task === undefined || status === undefined) return undefined;
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
  if (status === "review" || status === "stopped") {
    actions.push({ label: "Mark done", icon: CircleCheck, run: () => markDone(taskId) });
  }
  if ((status === "review" || status === "done") && lead !== undefined) {
    actions.push({ label: "Send for review", icon: Eye, run: () => openReview(taskId) });
  }
  if ((status === "review" || status === "done") && followUp !== undefined) {
    actions.push({ label: "Follow up", icon: MessageSquare, run: followUp });
  }
  if ((status === "stopped" || status === "failed") && lead !== undefined) {
    actions.push({
      label: "Continue",
      icon: Play,
      run: () => continueWork(taskId),
    });
  }
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
