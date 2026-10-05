import { Pencil } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { keepAgent } from "../../store/live.ts";
import styles from "./Office.module.css";

// What the user types becomes a handle: "Ben Smith" reads as "@ben-smith".
function toHandle(text: string): string {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `@${words}`;
}

// An agent's name, which the user can change. Names are unique: a lead names its workers by them.
export function AgentName({ agentId, name }: { agentId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [error, setError] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const handle = toHandle(text);
    if (handle === name) {
      setEditing(false);
      return;
    }
    try {
      keepAgent(await api.renameAgent(agentId, handle));
      setEditing(false);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  if (!editing) {
    return (
      <span className={styles.name}>
        <strong>{name}</strong>
        <button
          type="button"
          className={styles.rename}
          aria-label={`Rename ${name}`}
          onClick={() => {
            setText(name);
            setEditing(true);
          }}
        >
          <Pencil size={12} aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <form onSubmit={save} className={styles.renameForm}>
      <input
        aria-label="New name"
        className={styles.renameInput}
        value={text}
        // biome-ignore lint/a11y/noAutofocus: the user just asked to type a name
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
        onBlur={() => {
          if (error === undefined) setEditing(false);
        }}
      />
      {error === undefined ? null : (
        <span className={styles.renameError} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
