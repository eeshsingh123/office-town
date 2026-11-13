import { Eye } from "lucide-react";
import styles from "./TaskView.module.css";

// Under the message box, so a review is part of the conversation at any time.
export function ReviewAction({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.composerAction} onClick={onClick}>
      <Eye size={13} aria-hidden />
      Send for review
    </button>
  );
}
