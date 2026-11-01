import { Square } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

// A stray click must not end a long run, so this always asks.
export function StopTeamButton({ taskId, label }: { taskId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setAsking(true)}>
        <Square size={12} aria-hidden />
        {label}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Stop everyone on this task?"
        description="They stop right away, even in the middle of a step. Work already done stays. Send a message to carry on later."
        confirmLabel={label}
        danger
        onConfirm={() => api.stopTeam(taskId)}
      />
    </>
  );
}
