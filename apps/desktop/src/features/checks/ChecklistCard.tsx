import type { CheckItem, UserRequestEvent } from "@office-town/contract";
import { ListChecks, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { useSessionAgent } from "../../store/agents.ts";
import { clearDrafts, useDraft } from "../../store/drafts.ts";
import { requestKey } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { LineField } from "../../ui/LineField.tsx";
import card from "../requests/RequestCard.module.css";
import { useMinutesSince } from "../requests/RequestCard.tsx";
import styles from "./Checks.module.css";

type ChecklistEvent = Extract<UserRequestEvent, { type: "checklist.requested" }>;

export const FROM_LABEL: Record<CheckItem["from"], string> = {
  lead: "From the team",
  checker: "Added by the checker",
  user: "Yours",
};

// Ids the core never gives, so an added item cannot clash with the checker's.
function nextId(items: CheckItem[]): string {
  const used = new Set(items.map((item) => item.id));
  let number = 1;
  while (used.has(`u${number}`)) number += 1;
  return `u${number}`;
}

// The checker's list, which the user edits and approves before anything runs (D-73).
export function ChecklistCard({ event, context }: { event: ChecklistEvent; context?: ReactNode }) {
  const { requestId } = event.payload;
  const checker = useSessionAgent(event.sessionId);
  const minutes = useMinutesSince(event.timestamp);
  const draft = `request.${event.id}`;
  const [items, setItems] = useDraft<CheckItem[]>(`${draft}.items`, event.payload.items);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const complete =
    items.length > 0 &&
    items.every((item) => item.check.trim() !== "" && item.expected.trim() !== "");
  const edit = (id: string, change: Partial<CheckItem>) =>
    setItems(items.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const answer = async (approved: boolean) => {
    setSending(true);
    setError(undefined);
    try {
      await api.command(event.sessionId, {
        type: "answerChecklist",
        requestId,
        answer: approved
          ? {
              outcome: "approved",
              items: items.map((item) => ({
                ...item,
                check: item.check.trim(),
                expected: item.expected.trim(),
              })),
            }
          : { outcome: "declined" },
      });
      clearDrafts(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };

  return (
    <article id={requestKey(requestId)} className={card.card} aria-label="Checklist">
      <div className={card.head}>
        <ListChecks size={16} aria-hidden />
        Checklist from {checker?.name ?? "the checker"}
        {checker === undefined ? "" : ` · ${taskTitle(checker.task.prompt)}`}
        <span className={card.since}>{minutes === 0 ? "just now" : `waiting ${minutes} min`}</span>
      </div>
      <div className={card.body}>
        {context}
        <p className={styles.lead}>
          Edit, add or remove checks, then approve. The checker runs every one, and the list stays
          as approved for every later round.
        </p>
        <ol className={styles.items}>
          {items.map((item, index) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.number}>{index + 1}</span>
                <span className={styles.from}>{FROM_LABEL[item.from]}</span>
                <Button
                  variant="ghost"
                  icon
                  aria-label={`Remove check ${index + 1}`}
                  disabled={sending}
                  onClick={() => setItems(items.filter((kept) => kept.id !== item.id))}
                >
                  <X size={14} aria-hidden />
                </Button>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Check</span>
                <LineField
                  value={item.check}
                  onChange={(check) => edit(item.id, { check })}
                  disabled={sending}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Expected</span>
                <LineField
                  value={item.expected}
                  onChange={(expected) => edit(item.id, { expected })}
                  disabled={sending}
                />
              </label>
            </li>
          ))}
        </ol>
        <div>
          <Button
            variant="ghost"
            disabled={sending}
            onClick={() =>
              setItems([...items, { id: nextId(items), check: "", expected: "", from: "user" }])
            }
          >
            <Plus size={14} aria-hidden />
            Add a check
          </Button>
        </div>
        <div className={card.buttons}>
          <Button variant="primary" disabled={!complete || sending} onClick={() => answer(true)}>
            Approve and run {items.length} {items.length === 1 ? "check" : "checks"}
          </Button>
          <Button variant="ghost" disabled={sending} onClick={() => answer(false)}>
            Decline
          </Button>
        </div>
        {error === undefined ? null : (
          <p className={card.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
