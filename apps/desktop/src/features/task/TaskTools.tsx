import { Eye, Folder } from "lucide-react";
import { shell } from "../../shell.ts";
import styles from "./TaskView.module.css";

// The folder the task works in, with the other facts about it; in the app a click opens it.
export function FolderChip({ folder }: { folder: string | undefined }) {
  if (folder === undefined) return null;
  const name = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
  if (shell === undefined) {
    return (
      <span className={styles.chip} title={folder}>
        <Folder size={13} aria-hidden />
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.chipButton}`}
      title={`Open ${folder}`}
      onClick={() => void shell?.openFolder(folder)}
    >
      <Folder size={13} aria-hidden />
      {name}
    </button>
  );
}

// Under the message box, so a review is part of the conversation at any time.
export function ReviewAction({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.composerAction} onClick={onClick}>
      <Eye size={13} aria-hidden />
      Send for review
    </button>
  );
}
