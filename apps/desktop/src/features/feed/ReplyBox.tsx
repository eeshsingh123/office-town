import { type FormEvent, useId, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { clearDrafts, useDraft } from "../../store/drafts.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./Feed.module.css";

interface ReplyBoxProps {
  postId: string;
  agentId: string;
  taskId: string;
  onSent: () => void;
}

// The task page's message box in a post: at work, the agent reads it after its current step;
// once finished, the task continues with it.
export function ReplyBox({ postId, agentId, taskId, onSent }: ReplyBoxProps) {
  const id = useId();
  const draft = `feed.reply.${postId}`;
  const [text, setText] = useDraft(draft, "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const name = useApp((state) => state.agents[agentId]?.name ?? "the agent");
  const live = useApp((state) => {
    const entry = state.tasks[taskId];
    return (entry?.sessionIds ?? []).some((sessionId) => {
      const session = state.sessions[sessionId];
      return session?.agentId === agentId && isOpen(session);
    });
  });
  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await api.messageAgent(agentId, message, taskId);
      if (!live) await track(taskId);
      clearDrafts(draft);
      onSent();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  return (
    <form className={styles.reply} onSubmit={(event) => void send(event)}>
      <textarea
        id={id}
        className={styles.replyField}
        value={text}
        aria-label={`Reply to ${name}`}
        placeholder={`Reply to ${name}`}
        // biome-ignore lint/a11y/noAutofocus: the box opens because the user asked to reply.
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
      />
      <div className={styles.replyRow}>
        <span>
          {live ? `${name} reads it after the current step.` : "Your reply continues the task."}
        </span>
        <Button type="submit" variant="primary" busy={sending} disabled={text.trim() === ""}>
          Send
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
