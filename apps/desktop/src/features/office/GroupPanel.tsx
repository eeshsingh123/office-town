import { ArrowUp } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { select } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import type { AgentState } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import type { FloorAgent } from "./Floor.tsx";
import styles from "./Office.module.css";

// Grouped by status in M3; M4 groups by department instead.
const ORDER: AgentState[] = [
  "waiting",
  "working",
  "starting",
  "failed",
  "idle",
  "done",
  "interrupted",
  "stopped",
];

// Several agents at once: who they are, grouped, and what can be done to all of them. There is
// no "approve all": each request is read before it is answered.
export function GroupPanel({ members }: { members: FloorAgent[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const open = members.filter((member) => isOpen(member.agent.latest));
  const groups = Map.groupBy(members, (member) => STATE_LABELS[member.state]);
  const ordered = [...groups].sort(
    ([, a], [, b]) => ORDER.indexOf(a[0]?.state ?? "done") - ORDER.indexOf(b[0]?.state ?? "done"),
  );

  const toAll = async (send: (sessionId: string) => Promise<void>) => {
    setError(undefined);
    const results = await Promise.allSettled(open.map((member) => send(member.agent.latest.id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) setError(`${failed} of ${open.length} agents could not be reached.`);
  };
  const messageAll = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = text.trim();
    if (prompt === "") return;
    await toAll((sessionId) => api.command(sessionId, { type: "prompt", text: prompt }));
    setText("");
  };

  return (
    <aside className={styles.panel} aria-label={`${members.length} selected agents`}>
      <div className={styles.groupTitle}>
        <strong>{members.length} agents</strong>
        <Button variant="ghost" onClick={() => select([])}>
          Clear
        </Button>
      </div>
      {ordered.map(([label, group]) => (
        <section key={label} className={styles.group} aria-label={label}>
          <h3 className={styles.groupHead}>
            {group[0] === undefined ? null : <StatusIcon state={group[0].state} />}
            {label} · {group.length}
          </h3>
          {group.map(({ agent }) => (
            <button
              key={agent.id}
              type="button"
              className={styles.member}
              onClick={() => select([agent.id])}
            >
              <Avatar name={agent.name} colour={agent.colour} size={26} />
              <span className={styles.memberText}>
                <strong>{agent.name}</strong>
                <span>{taskTitle(agent.task.prompt)}</span>
              </span>
            </button>
          ))}
        </section>
      ))}
      <form className={styles.messageAll} onSubmit={messageAll}>
        <label htmlFor="message-all" className="visually-hidden">
          Message every open agent
        </label>
        <textarea
          id="message-all"
          rows={1}
          value={text}
          placeholder={
            open.length === 0
              ? "None of these agents is open"
              : `Message ${open.length} open agents`
          }
          disabled={open.length === 0}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          icon
          aria-label="Message all"
          disabled={open.length === 0 || text.trim() === ""}
        >
          <ArrowUp size={16} aria-hidden />
        </Button>
      </form>
      <div className={styles.panelActions}>
        <Button disabled={open.length === 0} onClick={() => void toAll(api.stop)}>
          Stop all ({open.length})
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
