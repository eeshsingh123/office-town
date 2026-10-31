import type { AgentRecord } from "@office-town/contract";
import { ArrowUp, Info } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { useDraft } from "../../store/drafts.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import fileStyles from "../attachments/Attachments.module.css";
import { AttachButton, PickedFiles } from "../attachments/PickedFiles.tsx";
import { useAttachments } from "../attachments/use-attachments.ts";
import { useSeesImages } from "../attachments/use-sees-images.ts";
import { useLibrary } from "../library/library.ts";
import { useLibraryPicker } from "../library/use-library-picker.tsx";
import { useOffice } from "../office/office-state.ts";
import styles from "./Chat.module.css";

// Only a lead at work gets the note.
function useLead(agent: AgentRecord) {
  return useApp((state) => {
    const department =
      agent.departmentId === undefined ? undefined : state.departments[agent.departmentId];
    if (department === undefined || department.leadAgentId === agent.id) return undefined;
    return state.agents[department.leadAgentId];
  });
}

// Its department's, else that of the task it worked on last.
function useWorkspaceOf(agent: AgentRecord): string | undefined {
  return useApp((state) => {
    if (agent.departmentId !== undefined) return state.departments[agent.departmentId]?.workspaceId;
    const latest = Object.values(state.sessions)
      .filter((session) => session.agentId === agent.id)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return latest === undefined ? undefined : state.tasks[latest.taskId]?.task.workspaceId;
  });
}

function leadAtWork(leadId: string): boolean {
  return Object.values(useApp.getState().sessions).some(
    (session) => session.agentId === leadId && isOpen(session),
  );
}

// A worker's lead hears of it (D-49).
export function Composer({
  agent,
  onNoted,
}: {
  agent: AgentRecord;
  onNoted: (text: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const compose = useOffice((state) => state.compose);
  // A follow-up goes to the goal it was opened from, not to a newer one.
  const [followUp, setFollowUp] = useState<string>();
  const lead = useLead(agent);
  const [text, setText] = useDraft(`chat.${agent.id}.text`, "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const attached = useAttachments(`chat.${agent.id}.files`);
  const { harness, environment, model } = agent.settings;
  const seesImages = useSeesImages({ harness, environment, ...(model ? { model } : {}) });
  const library = useLibrary(useWorkspaceOf(agent));
  const picker = useLibraryPicker({
    items: library,
    text,
    setText,
    field,
    onPick: attached.addFromLibrary,
  });

  useEffect(() => {
    if (compose === undefined) return;
    setFollowUp(compose.taskId);
    field.current?.focus();
    useOffice.setState({ compose: undefined });
  }, [compose]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (message === "" || sending || attached.adding) return;
    setSending(true);
    setError(undefined);
    const noted = lead !== undefined && leadAtWork(lead.id);
    try {
      await api.messageAgent(agent.id, message, followUp, attached.ids);
      if (noted) onNoted(message);
      setText("");
      attached.clear();
      setFollowUp(undefined);
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

  return (
    <form
      className={`${styles.composer} ${attached.dragging ? fileStyles.dropping : ""}`}
      onSubmit={send}
      {...attached.dropHandlers}
    >
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PickedFiles files={attached} seesImages={seesImages} />
      <div className={styles.box}>
        {picker.list}
        <AttachButton files={attached} library={library} className={fileStyles.attach} />
        <label htmlFor={id} className="visually-hidden">
          Message {agent.name}
        </label>
        <textarea
          id={id}
          ref={field}
          rows={1}
          value={text}
          placeholder={`Message ${agent.name}`}
          {...picker.comboboxProps}
          onChange={(change) => {
            setText(change.target.value);
            picker.onInput(change.target.value, change.target.selectionStart);
          }}
          onBlur={picker.close}
          onKeyDown={onKeyDown}
          onPaste={attached.onPaste}
        />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label="Send"
          disabled={text.trim() === "" || sending || attached.adding}
        >
          <ArrowUp size={16} aria-hidden />
        </Button>
      </div>
      {lead === undefined ? null : (
        <p className={styles.hint}>
          <Info size={12} aria-hidden />
          Your message is also noted to {lead.name} (lead).
        </p>
      )}
    </form>
  );
}
