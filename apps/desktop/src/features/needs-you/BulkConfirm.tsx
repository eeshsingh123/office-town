import type { AnswerPermissionsResult } from "@office-town/contract";
import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import styles from "./NeedsYouView.module.css";
import type { Ask } from "./queue.ts";

export interface BulkAnswer {
  decision: "allow" | "reject";
  // Approvals only.
  asks: Ask[];
  // "filtered", "selected", or a group's name.
  scope: string;
}

interface BulkConfirmProps {
  answer: BulkAnswer | undefined;
  send: (answer: BulkAnswer) => Promise<AnswerPermissionsResult>;
  onCancel: () => void;
  onDone: (decision: BulkAnswer["decision"], answered: number, skipped: number) => void;
}

const SORTS: [string, (ask: Ask) => boolean][] = [
  ["Web searches and pages", (ask) => kindOf(ask) === "fetch"],
  ["Commands", (ask) => kindOf(ask) === "execute"],
  ["File changes", (ask) => ["edit", "delete", "move"].includes(kindOf(ask) ?? "")],
];

function kindOf(ask: Ask): string | undefined {
  return ask.event.type === "permission.requested" ? ask.event.payload.kind : undefined;
}

// What the answer covers, by sort of action, so a large Approve all is read before it is sent.
function breakdown(asks: readonly Ask[]): [string, number][] {
  const rows = SORTS.map(([name, test]): [string, number] => [name, asks.filter(test).length]);
  const other = asks.length - rows.reduce((sum, [, count]) => sum + count, 0);
  return [...rows, ["Other", other] as [string, number]].filter(([, count]) => count > 0);
}

export function BulkConfirm({ answer, send, onCancel, onDone }: BulkConfirmProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  if (answer === undefined) return null;
  const { decision, asks, scope } = answer;
  const count = asks.length;
  const verb = decision === "allow" ? "Approve" : "Reject";
  const tasks = new Set(asks.map((ask) => ask.taskId)).size;
  const departments = [...new Set(asks.map((ask) => ask.departmentName))];
  const where =
    scope === "filtered"
      ? "Every approval that matches your filters."
      : scope === "selected"
        ? "The approvals you selected."
        : `Every approval waiting in ${scope}.`;
  const confirm = async () => {
    setSending(true);
    setError(undefined);
    try {
      const result = await send(answer);
      onDone(decision, result.answered, result.skipped);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !sending) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialog.overlay} />
        <AlertDialog.Content className={dialog.content}>
          <AlertDialog.Title className={dialog.title}>
            {verb} {count === 1 ? "1 request" : `${count} requests`}?
          </AlertDialog.Title>
          <AlertDialog.Description className={dialog.description}>
            {where}{" "}
            {decision === "allow"
              ? "Each agent carries on as soon as its request is approved."
              : "Each agent is told no and decides what to do next."}
          </AlertDialog.Description>
          <ul className={styles.breakdown}>
            {breakdown(asks).map(([name, number]) => (
              <li key={name}>
                <span>{name}</span>
                <strong>{number}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.levelNote}>
            Across {tasks === 1 ? "1 task" : `${tasks} tasks`} in{" "}
            {departments.length > 3 ? `${departments.length} departments` : departments.join(", ")}.
          </p>
          {error === undefined ? null : (
            <p className={dialog.error} role="alert">
              {error}
            </p>
          )}
          <div className={dialog.actions}>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" disabled={sending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant="primary" disabled={sending} onClick={() => void confirm()}>
              {verb} {count}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
