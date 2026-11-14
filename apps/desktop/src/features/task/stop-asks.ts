import { api } from "../../api/client.ts";
import type { Ask } from "../../ui/ConfirmDialog.tsx";

// Every Stop asks first, with the same words wherever it is clicked.

const AFTER = "Send a message to resume.";

export const stopAgentAsk = (name: string, sessionId: string): Ask => ({
  title: `Stop ${name}?`,
  description: `${name} stops now. ${AFTER}`,
  confirmLabel: "Stop",
  run: () => api.stop(sessionId),
});

// Away from the task's own page, the title names the task.
export const stopTeamAsk = (taskId: string, label: string, title?: string): Ask => ({
  title: title === undefined ? "Stop everyone on this task?" : `Stop everyone on “${title}”?`,
  description: `They stop now. ${AFTER}`,
  confirmLabel: label,
  run: () => api.stopTeam(taskId),
});

// Agents picked together on the floor; `run` reports any that could not be stopped.
export const stopPickedAsk = (count: number, run: () => Promise<void>): Ask => ({
  title: `Stop ${count} ${count === 1 ? "agent" : "agents"}?`,
  description: `They stop now. ${AFTER}`,
  confirmLabel: "Stop",
  run,
});

// A lead waiting on its proposed team; `run` shows a failure on the card.
export const stopProposalAsk = (lead: string, run: () => Promise<void>): Ask => ({
  title: "Stop this task?",
  description: `${lead} stops now and the proposed team is not created. ${AFTER}`,
  confirmLabel: "Stop the task",
  run,
});
