import { ArrowUp } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./TaskView.module.css";

// A message goes to the running agent, or resumes an ended one in a new session of the task.
export function MessageBox({ agent, className }: { agent: Agent; className?: string | undefined }) {
  const id = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const canResume = useApp(
    (state) =>
      state.harnesses.find((known) => known.harness === agent.latest.options.harness)?.capabilities
        .resume ?? false,
  );
  const live = isOpen(agent.latest);
  const resumable = !live && canResume && agent.latest.harnessSessionId !== undefined;

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = text.trim();
    if (prompt === "" || sending || !(live || resumable)) return;
    setSending(true);
    setError(undefined);
    try {
      if (live) {
        await api.command(agent.latest.id, { type: "prompt", text: prompt });
      } else {
        await api.resume(agent.latest.id, prompt);
        await track(agent.taskId);
      }
      setText("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) void send(event);
  };

  const placeholder = live
    ? "Message the agent"
    : resumable
      ? "Continue this task with a message"
      : "This agent cannot be continued";
  return (
    <form className={className ?? styles.composer} onSubmit={send}>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.messageBox}>
        <label htmlFor={id} className="visually-hidden">
          {placeholder}
        </label>
        <textarea
          id={id}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={!(live || resumable)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label={live ? "Send" : "Continue"}
          disabled={text.trim() === "" || sending || !(live || resumable)}
        >
          <ArrowUp size={16} aria-hidden />
        </Button>
      </div>
    </form>
  );
}
