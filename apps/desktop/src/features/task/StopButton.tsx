import { Square } from "lucide-react";
import { type Ask, ConfirmButton } from "../../ui/ConfirmDialog.tsx";
import { stopTeamAsk } from "./stop-asks.ts";

// Every Stop on a task's page: red, and it asks first.
export function StopButton({ ask, label = "Stop" }: { ask: Ask; label?: string }) {
  return (
    <ConfirmButton variant="danger" ask={ask}>
      <Square size={12} aria-hidden />
      {label}
    </ConfirmButton>
  );
}

export function StopTeamButton({ taskId, label }: { taskId: string; label: string }) {
  return <StopButton ask={stopTeamAsk(taskId, label)} label={label} />;
}
