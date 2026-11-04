import { Square } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

// Shared with a department's right-click menu, so both ask the same way. Away from the task's
// own page, the title names the task.
export const stopTeamAsk = (taskId: string, label: string, title?: string) => ({
  title: title === undefined ? "Stop everyone on this task?" : `Stop everyone on “${title}”?`,
  description:
    "They stop right away, even in the middle of a step. Work already done stays. Send a message to carry on later.",
  confirmLabel: label,
  run: () => api.stopTeam(taskId),
});

// A stray click must not end a long run, so this always asks.
export function StopTeamButton({ taskId, label }: { taskId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const ask = stopTeamAsk(taskId, label);
  return (
    <>
      <Button variant="danger" onClick={() => setAsking(true)}>
        <Square size={12} aria-hidden />
        {label}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={ask.title}
        description={ask.description}
        confirmLabel={ask.confirmLabel}
        danger
        onConfirm={ask.run}
      />
    </>
  );
}
