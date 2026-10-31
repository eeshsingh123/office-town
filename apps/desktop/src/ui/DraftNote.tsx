import { useState } from "react";
import { discardDrafts, useHasDraft } from "../store/drafts.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import styles from "./DraftNote.module.css";

interface DraftNoteProps {
  scope: string;
  // Changes to something saved, not a new thing being set up.
  editing?: boolean;
  // By default the screen opens afresh.
  onDiscard?: () => void;
}

// Says that what is on screen is kept, and is the way to throw it away.
export function DraftNote({ scope, editing = false, onDiscard }: DraftNoteProps) {
  const [asking, setAsking] = useState(false);
  const kept = useHasDraft(scope);
  if (!kept) return null;
  const action = editing ? "Discard" : "Start over";
  return (
    <span className={styles.note}>
      {editing ? "Unsaved changes" : "Draft saved"}
      {" · "}
      <button type="button" className={styles.action} onClick={() => setAsking(true)}>
        {action}
      </button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={`${action}?`}
        description={
          editing
            ? "Your unsaved changes here will be lost."
            : "Everything you entered here will be cleared."
        }
        confirmLabel={action}
        onConfirm={async () => (onDiscard ?? (() => discardDrafts(scope)))()}
      />
    </span>
  );
}
