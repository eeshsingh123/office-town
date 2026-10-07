import type { AgentRecord } from "@office-town/contract";
import { ArrowUp, Info } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import { useOffice } from "../office/office-state.ts";
import styles from "./Chat.module.css";

// The lead of a worker's department, and whether it is at work: only then does it get the note.
function useLead(agent: AgentRecord) {
  return useApp((state) => {
    const department =
      agent.departmentId === undefined ? undefined : state.departments[agent.departmentId];
    if (department === undefined || department.leadAgentId === agent.id) return undefined;
    return state.agents[department.leadAgentId];
  });
}

function leadAtWork(leadId: string): boolean {
  return Object.values(useApp.getState().sessions).some(
    (session) => session.agentId === leadId && isOpen(session),
  );
}

// The user's words to the agent, at work or finished; a worker's lead hears of it (D-49).
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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (compose === undefined) return;
    setFollowUp(compose.taskId);
    field.current?.focus();
    useOffice.setState({ compose: undefined });
  }, [compose]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    setError(undefined);
    const noted = lead !== undefined && leadAtWork(lead.id);
    try {
      await api.messageAgent(agent.id, message, followUp);
      if (noted) onNoted(message);
      setText("");
      setFollowUp(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Enter while an input method composes picks a word; it does not send.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      void send(event);
    }
  };

  return (
    <form className={styles.composer} onSubmit={send}>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.box}>
        <label htmlFor={id} className="visually-hidden">
          Message {agent.name}
        </label>
        <textarea
          id={id}
          ref={field}
          rows={1}
          value={text}
          placeholder={`Message ${agent.name}`}
          onChange={(change) => setText(change.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label="Send"
          disabled={text.trim() === "" || sending}
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
