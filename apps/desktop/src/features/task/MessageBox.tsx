import { ArrowUp } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { useDraft } from "../../store/drafts.ts";
import { useKept, writeKept } from "../../store/kept.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import fileStyles from "../attachments/Attachments.module.css";
import { AttachButton, PickedFiles } from "../attachments/PickedFiles.tsx";
import { useAttachments } from "../attachments/use-attachments.ts";
import { useSeesImages } from "../attachments/use-sees-images.ts";
import { useLibrary } from "../library/library.ts";
import { useLibraryPicker } from "../library/use-library-picker.tsx";
import { COMPOSER_FOCUS } from "./sub-agent-state.ts";
import styles from "./TaskView.module.css";

interface MessageBoxProps {
  agent: Agent;
  className?: string | undefined;
  // Small actions under the box, such as Send for review.
  actions?: ReactNode;
}

// Sent like a chat message, so a worker's lead hears of it (D-49) and a lead continues its team (D-86).
export function MessageBox({ agent, className, actions }: MessageBoxProps) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [focusFor] = useKept(COMPOSER_FOCUS);
  useEffect(() => {
    if (focusFor !== agent.id) return;
    field.current?.focus();
    writeKept(COMPOSER_FOCUS, undefined);
  }, [focusFor, agent.id]);
  const [text, setText] = useDraft(`message.${agent.id}`, "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const attached = useAttachments(`message.${agent.id}.files`);
  const { harness, environment, model } = agent.latest.options;
  const seesImages = useSeesImages({ harness, environment, ...(model ? { model } : {}) });
  const library = useLibrary(agent.task.workspaceId);
  const picker = useLibraryPicker({
    items: library,
    text,
    setText,
    field,
    onPick: attached.addFromLibrary,
  });
  const canResume = useApp(
    (state) =>
      state.harnesses.find((known) => known.harness === agent.latest.options.harness)?.capabilities
        .resume ?? false,
  );
  const live = isOpen(agent.latest);
  const open = live || (canResume && agent.latest.harnessSessionId !== undefined);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = text.trim();
    if (prompt === "" || sending || attached.adding || !open) return;
    setSending(true);
    setError(undefined);
    try {
      await api.messageAgent(agent.id, prompt, agent.taskId, attached.ids);
      if (!live) await track(agent.taskId);
      setText("");
      attached.clear();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (picker.onKeyDown(event)) return;
    // Enter while an input method composes picks a word; it does not send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      void send(event);
    }
  };

  const placeholder = live
    ? "Message the agent"
    : open
      ? "Send a message to continue"
      : "This task can't be continued";
  return (
    <form
      className={`${className ?? styles.composer} ${attached.dragging ? fileStyles.dropping : ""}`}
      onSubmit={send}
      {...(open ? attached.dropHandlers : {})}
    >
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PickedFiles files={attached} seesImages={seesImages} className={styles.picked} />
      <div className={styles.messageBox}>
        {picker.list}
        {open ? (
          <AttachButton files={attached} library={library} className={fileStyles.attach} />
        ) : null}
        <label htmlFor={id} className="visually-hidden">
          {placeholder}
        </label>
        <textarea
          id={id}
          ref={field}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={!open}
          {...picker.comboboxProps}
          onChange={(change) => {
            setText(change.target.value);
            picker.onInput(change.target.value, change.target.selectionStart);
          }}
          onBlur={picker.close}
          onKeyDown={onKeyDown}
          onPaste={open ? attached.onPaste : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label={live ? "Send" : "Continue"}
          disabled={text.trim() === "" || sending || attached.adding || !open}
        >
          <ArrowUp size={16} aria-hidden />
        </Button>
      </div>
      {actions === undefined ? null : <div className={styles.composerActions}>{actions}</div>}
    </form>
  );
}
