import type { AgentCommand, UserRequestEvent, WorkspaceRecord } from "@office-town/contract";
import { Network, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useSessionAgent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { requestKey } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { WorkspaceDialog } from "../new-task/WorkspaceDialog.tsx";
import card from "../requests/RequestCard.module.css";
import { useMinutesSince } from "../requests/RequestCard.tsx";
import { departmentName, usePlan } from "../work/use-plan.ts";
import styles from "./PlanCard.module.css";
import { PlanRows } from "./PlanRows.tsx";
import {
  guardWarnings,
  type KeptPiece,
  type PlanRow,
  planChanges,
  planProblem,
  toApproved,
  toRows,
} from "./plan-edit.ts";

type PlanEvent = Extract<UserRequestEvent, { type: "plan.requested" }>;
type PlanAnswer = Extract<AgentCommand, { type: "answerPlan" }>["answer"];

// The saved workspaces, with any made from this card first.
function useWorkspaces() {
  const listed = useLoaded("workspaces", api.listWorkspaces);
  const [created, setCreated] = useState<WorkspaceRecord[]>([]);
  const [adding, setAdding] = useState<(workspaceId: string) => void>();
  const dialog = (
    <WorkspaceDialog
      open={adding !== undefined}
      onOpenChange={(open) => {
        if (!open) setAdding(undefined);
      }}
      onCreated={(workspace) => {
        setCreated([workspace, ...created]);
        adding?.(workspace.id);
      }}
    />
  );
  return {
    workspaces: [...created, ...(listed.value ?? [])],
    // A function in state is called when set, so the callback is wrapped once more.
    add: (onCreated: (workspaceId: string) => void) => setAdding(() => onCreated),
    dialog,
  };
}

function ChangeList({ event, rows }: { event: PlanEvent; rows: PlanRow[] }) {
  const taskId = useApp((state) => state.sessions[event.sessionId]?.taskId);
  const departments = useApp((state) => state.departments);
  const plan = usePlan(taskId);
  const changes = useMemo(() => planChanges(plan, event.payload.pieces), [plan, event]);
  const nameOf = (row: PlanRow | undefined) =>
    row === undefined
      ? ""
      : "departmentId" in row.department
        ? (departments[row.department.departmentId]?.name ?? "")
        : row.department.newDepartment.name;
  const rowOf = (key: string) => rows.find((row) => row.key === key);
  return (
    <div className={styles.changes}>
      {changes.removed.length === 0 ? null : (
        <div>
          <div className={styles.changeLabel}>Removed</div>
          {changes.removed.map((piece) => (
            <p key={piece.id} className={styles.removed}>
              {piece.title} · {departmentName(piece, departments)}
            </p>
          ))}
        </div>
      )}
      {[
        { label: "Added", pieces: changes.added },
        { label: "Changed", pieces: changes.changed },
      ].map(({ label, pieces }) =>
        pieces.length === 0 ? null : (
          <div key={label}>
            <div className={styles.changeLabel}>{label}</div>
            {pieces.map((piece) => (
              <p key={piece.key}>
                {piece.title} · {nameOf(rowOf(piece.key))}
                {piece.waitsOn.length === 0
                  ? ""
                  : ` · waits on ${piece.waitsOn.map((key) => rowOf(key)?.title ?? plan.find((one) => one.key === key)?.title ?? key).join(", ")}`}
              </p>
            ))}
          </div>
        ),
      )}
      {changes.doneUnchanged === 0 ? null : (
        <p className={styles.hint}>
          {changes.doneUnchanged === 1
            ? "1 done piece unchanged"
            : `${changes.doneUnchanged} done pieces unchanged`}
        </p>
      )}
    </div>
  );
}

// The chief's plan for the user to edit and approve, or a changed plan to approve (D-49).
export function PlanCard({ event, context }: { event: PlanEvent; context?: ReactNode }) {
  const { requestId, reason, replan, pieces } = event.payload;
  const chief = useSessionAgent(event.sessionId);
  const departments = useApp((state) => state.departments);
  const plan = usePlan(chief?.taskId);
  const minutes = useMinutesSince(event.timestamp);
  const [rows, setRows] = useState(() => toRows(pieces));
  const [editing, setEditing] = useState(!replan);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const { workspaces, add, dialog } = useWorkspaces();

  const kept: KeptPiece[] = plan.filter(
    (piece) => piece.status === "done" || piece.status === "working",
  );
  const problem = planProblem(
    rows,
    kept,
    Object.values(departments).map((department) => department.name),
  );
  const warnings = guardWarnings(rows, departments);
  const answer = async (decision: PlanAnswer) => {
    setSending(true);
    setError(undefined);
    try {
      await api.command(event.sessionId, { type: "answerPlan", requestId, answer: decision });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };
  const approve = () => void answer({ outcome: "approved", pieces: toApproved(rows) });
  const lead = chief?.latest.options;

  return (
    <article id={requestKey(requestId)} className={card.card} aria-label="Plan">
      <div className={card.head}>
        <Network size={16} aria-hidden />
        {replan ? "Changed plan from " : "Plan from "}
        {chief?.name ?? "the chief"}
        {chief === undefined ? "" : ` · ${taskTitle(chief.task.prompt)}`}
        <span className={card.since}>{minutes === 0 ? "just now" : `waiting ${minutes} min`}</span>
      </div>
      <div className={card.body}>
        {context}
        {reason === undefined ? null : <p className={styles.reason}>"{reason}"</p>}
        {warnings.map((warning) => (
          <p key={warning} className={styles.warning}>
            <TriangleAlert size={14} aria-hidden />
            {warning}
          </p>
        ))}
        {editing ? (
          <PlanRows
            rows={rows}
            onChange={setRows}
            kept={kept}
            workspaces={workspaces}
            onNewWorkspace={add}
            defaultLead={{
              harness: lead?.harness ?? "claude",
              environment: lead?.environment ?? { kind: "native" },
            }}
          />
        ) : (
          <ChangeList event={event} rows={rows} />
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Note (sent with Send back or Decline)</span>
          <textarea
            className={styles.input}
            rows={2}
            value={note}
            placeholder="For example: leave QA out, Web team tests it"
            onChange={(change) => setNote(change.target.value)}
          />
        </label>
        <div className={card.buttons}>
          <Button variant="primary" disabled={problem !== undefined || sending} onClick={approve}>
            {replan ? "Approve change" : "Approve plan"}
          </Button>
          {editing ? null : (
            <Button disabled={sending} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button
            disabled={note.trim() === "" || sending}
            onClick={() => void answer({ outcome: "revised", note: note.trim() })}
          >
            {editing ? "Send back with my note" : "Send back"}
          </Button>
          <Button
            variant="ghost"
            disabled={sending}
            onClick={() =>
              void answer({
                outcome: "declined",
                ...(note.trim() === "" ? {} : { note: note.trim() }),
              })
            }
          >
            Decline
          </Button>
        </div>
        {problem === undefined ? null : <p className={styles.hint}>{problem}</p>}
        {error === undefined ? null : (
          <p className={card.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {dialog}
    </article>
  );
}
