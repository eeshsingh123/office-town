import { Square } from "lucide-react";
import { ConfirmButton } from "../../ui/ConfirmDialog.tsx";
import { stopTeamAsk } from "./stop-asks.ts";

export function StopTeamButton({ taskId, label }: { taskId: string; label: string }) {
  return (
    <ConfirmButton variant="danger" ask={stopTeamAsk(taskId, label)}>
      <Square size={12} aria-hidden />
      {label}
    </ConfirmButton>
  );
}
