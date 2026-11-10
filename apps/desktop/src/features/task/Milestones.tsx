import type { MilestoneRecord, MilestoneText } from "@office-town/contract";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import type { ShownStatus } from "./goal-progress.ts";
import styles from "./Progress.module.css";

function StatusIcon({ status }: { status: ShownStatus }) {
  if (status === "met") return <CircleCheck size={15} className={styles.ok} aria-label="Met" />;
  if (status === "notMet") return <CircleX size={15} className={styles.bad} aria-label="Not met" />;
  if (status === "doing") {
    return (
      <LoaderCircle size={15} className={`${styles.running} spin`} aria-label="Being worked on" />
    );
  }
  return (
    <CircleDashed
      size={15}
      className={styles.quiet}
      aria-label={status === "unreported" ? "Not reported" : "Not started"}
    />
  );
}

function Editor({
  initial,
  owner,
  onSave,
  onCancel,
}: {
  initial?: MilestoneText;
  owner: string | undefined;
  onSave: (text: MilestoneText) => Promise<void>;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState(initial?.outcome ?? "");
  const [see, setSee] = useState(initial?.see ?? "");
  const [saving, setSaving] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (outcome.trim() === "" || saving) return;
    setSaving(true);
    onSave({ outcome: outcome.trim(), see: see.trim() })
      .then(onCancel)
      .catch(() => {
        setSaving(false);
        showToast("The milestone could not be saved.");
      });
  };
  return (
    <form className={styles.editor} onSubmit={submit}>
      <label className={styles.field}>
        What you'll get
        <textarea
          className={styles.input}
          rows={1}
          value={outcome}
          placeholder="For example: Recipes can be printed on one page"
          // biome-ignore lint/a11y/noAutofocus: opened to type in
          autoFocus
          onChange={(change) => setOutcome(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
            if (event.key === "Escape") onCancel();
          }}
        />
      </label>
      <label className={styles.field}>
        How you'll see it
        <textarea
          className={styles.input}
          rows={2}
          value={see}
          placeholder="What you would do to see it, in your own words"
          onChange={(change) => setSee(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
      </label>
      <div className={styles.editorFoot}>
        {owner === undefined ? null : (
          <span className={styles.hint}>{owner} is told at the next step.</span>
        )}
        <Button variant="ghost" className={styles.small} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          className={styles.small}
          disabled={outcome.trim() === "" || saving}
        >
          {initial === undefined ? "Add" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Delivery({ milestone }: { milestone: MilestoneRecord }) {
  const agents = useApp((state) => state.agents);
  const { delivery, origin, changedBy } = milestone;
  if (delivery === undefined) {
    const by = changedBy === undefined || changedBy === "user" ? undefined : agents[changedBy];
    return by === undefined ? null : <span>Changed by {by.name}</span>;
  }
  const name = agents[delivery.agentId]?.name ?? "The agent";
  if (delivery.state === "telling") {
    return <span className={`${styles.pill} ${styles.pillQuiet}`}>Telling {name}…</span>;
  }
  const yours = origin === "user" ? "Yours" : "Changed by you";
  return (
    <span className={`${styles.pill} ${styles.pillAccent}`}>
      {yours} · {name} has it
    </span>
  );
}

function Row({
  milestone,
  status,
  owner,
  editable,
}: {
  milestone: MilestoneRecord;
  status: ShownStatus;
  owner: string | undefined;
  editable: boolean;
}) {
  const agents = useApp((state) => state.agents);
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [proofOpen, setProofOpen] = useState(false);
  if (mode === "edit") {
    return (
      <li>
        <Editor
          initial={milestone}
          owner={owner}
          onSave={async (text) => {
            await api.editMilestone(milestone.id, text);
          }}
          onCancel={() => setMode("view")}
        />
      </li>
    );
  }
  const checker =
    milestone.reportedBy === undefined ? undefined : agents[milestone.reportedBy]?.name;
  const remove = () => {
    api.removeMilestone(milestone.id).catch(() => {
      showToast("The milestone could not be removed.");
    });
  };
  return (
    <li>
      <div className={styles.row}>
        <span className={styles.icon}>
          <StatusIcon status={status} />
        </span>
        <div className={styles.text}>
          <div className={styles.outcome}>{milestone.outcome}</div>
          {milestone.see === "" ? null : (
            <div className={styles.see}>
              <b>How you'll see it:</b> {milestone.see}
            </div>
          )}
          <div className={styles.meta}>
            {status === "met" ? (
              <span>Met{checker === undefined ? "" : ` · checked by ${checker}`}</span>
            ) : null}
            {status === "notMet" ? <span className={styles.metaBad}>Not met</span> : null}
            {status === "unreported" ? <span>Not reported</span> : null}
            {milestone.proof === undefined ? null : (
              <button
                type="button"
                className={styles.link}
                aria-expanded={proofOpen}
                onClick={() => setProofOpen(!proofOpen)}
              >
                {proofOpen ? "Hide proof" : "Proof"}
              </button>
            )}
            <Delivery milestone={milestone} />
          </div>
          {proofOpen && milestone.proof !== undefined ? (
            <div className={styles.proof}>{milestone.proof}</div>
          ) : null}
        </div>
        {editable ? (
          <span className={styles.tools}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Edit milestone"
              title="Edit"
              onClick={() => setMode("edit")}
            >
              <Pencil size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Remove milestone"
              title="Remove"
              onClick={() => setMode("remove")}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </span>
        ) : (
          <span />
        )}
      </div>
      {mode === "remove" ? (
        <div className={styles.confirm} role="alert">
          <span>Remove this milestone?{owner === undefined ? "" : ` ${owner} will be told.`}</span>
          <Button variant="ghost" className={styles.small} onClick={() => setMode("view")}>
            Keep
          </Button>
          <Button variant="danger" className={styles.small} onClick={remove}>
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function AddMilestone({
  label,
  owner,
  onAdd,
}: {
  label: string;
  owner: string | undefined;
  onAdd: (text: MilestoneText) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  if (adding) return <Editor owner={owner} onSave={onAdd} onCancel={() => setAdding(false)} />;
  return (
    <button type="button" className={styles.add} onClick={() => setAdding(true)}>
      <Plus size={14} aria-hidden />
      {label}
    </button>
  );
}

export function MilestoneList({
  milestones,
  statusOf,
  owner,
  editable,
}: {
  milestones: readonly MilestoneRecord[];
  statusOf: (milestone: MilestoneRecord) => ShownStatus;
  // Who is told of a change.
  owner: string | undefined;
  editable: boolean;
}) {
  return (
    <ul className={styles.list}>
      {milestones.map((milestone) => (
        <Row
          key={milestone.id}
          milestone={milestone}
          status={statusOf(milestone)}
          owner={owner}
          editable={editable}
        />
      ))}
    </ul>
  );
}

// One segment per milestone, so the bar reads as the list does.
export function Segments({ statuses }: { statuses: readonly ShownStatus[] }) {
  return (
    <div className={styles.segments} aria-hidden>
      {statuses.map((status, index) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: one bar segment per place in the list
          key={index}
          className={styles[status === "unreported" ? "todo" : status]}
        />
      ))}
    </div>
  );
}

export function MiniBar({ statuses }: { statuses: readonly ShownStatus[] }) {
  return (
    <span className={styles.mini} aria-hidden>
      {statuses.map((status, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one bar segment per place in the list
        <i key={index} className={styles[status === "unreported" ? "todo" : status]} />
      ))}
    </span>
  );
}
