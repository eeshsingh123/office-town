import { useMemo } from "react";
import { useApp } from "../../store/app-store.ts";
import { type FileUse, fileUses } from "../../trace/file-uses.ts";
import { clockTime } from "../../ui/format.ts";
import styles from "./Attachments.module.css";
import { sizeText, typeLabel } from "./kinds.ts";

function statusOf({ attachment, openedAt, filesOpened }: FileUse): { text: string; ok: boolean } {
  if (attachment.inline) return { text: "Seen", ok: true };
  if (openedAt === undefined) return { text: "Not opened", ok: false };
  if (attachment.kind !== "folder") return { text: `Opened ${clockTime(openedAt)}`, ok: true };
  if (filesOpened === 0) return { text: "Opened", ok: true };
  return { text: `Opened ${filesOpened} ${filesOpened === 1 ? "file" : "files"}`, ok: true };
}

// For a view that shows one trace item at a time.
export function useFileUses(sessionId: string, messageId: string): FileUse[] | undefined {
  const trace = useApp((state) => state.traces[sessionId]);
  return useMemo(
    () => (trace === undefined ? undefined : fileUses(trace).get(messageId)),
    [trace, messageId],
  );
}

// What went with a message, and whether the agent actually opened each one.
export function SentFiles({ uses }: { uses: readonly FileUse[] | undefined }) {
  if (uses === undefined || uses.length === 0) return null;
  return (
    <ul className={styles.sent} aria-label="Files sent">
      {uses.map((use) => {
        const { attachment } = use;
        const status = statusOf(use);
        const detail =
          attachment.kind === "folder"
            ? "folder"
            : attachment.bytes === undefined
              ? ""
              : sizeText(attachment.bytes);
        return (
          <li key={attachment.id} className={styles.sentRow} title={attachment.path}>
            <span className={styles.tile} aria-hidden>
              {typeLabel(attachment.name, attachment.kind)}
            </span>
            <span className={styles.sentName}>
              {attachment.name}
              <small>{detail}</small>
            </span>
            <span className={`${styles.status} ${status.ok ? styles.ok : styles.no}`}>
              {status.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
