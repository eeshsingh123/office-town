import { Square } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./TaskView.module.css";

// Stops every agent of a task; a failure shows beside the button.
export function StopTeamButton({ taskId, label }: { taskId: string; label: string }) {
  const [error, setError] = useState<string>();
  const stop = async () => {
    setError(undefined);
    try {
      await api.stopTeam(taskId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <Button onClick={() => void stop()}>
        <Square size={12} aria-hidden />
        {label}
      </Button>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
