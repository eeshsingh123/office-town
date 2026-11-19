import type { ReactNode } from "react";
import form from "../../ui/Form.module.css";
import { LineField } from "../../ui/LineField.tsx";
import { PointsField } from "../../ui/PointsField.tsx";
import styles from "./AgentFields.module.css";
import { type ChipSettings, SettingsChips } from "./SettingsChips.tsx";

// One field set, in one order, wherever an agent is edited: its profile, a team member and a
// template (D-111). Identity, then Job, then Runs on.
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group} aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {children}
    </section>
  );
}

interface JobFieldsProps {
  id: string;
  job: string;
  notes: string;
  onJob: (job: string) => void;
  onNotes: (notes: string) => void;
  jobHint?: string;
  notesHint: string;
  notesPlaceholder?: string;
}

export function JobFields({
  id,
  job,
  notes,
  onJob,
  onNotes,
  jobHint = "One line to tell your agents apart.",
  notesHint,
  notesPlaceholder = "For example: Work only on your own branch",
}: JobFieldsProps) {
  return (
    <>
      <label className={form.field} htmlFor={`${id}-job`}>
        <span className={form.label}>What it does</span>
        <span className={form.hint}>{jobHint}</span>
        <LineField
          id={`${id}-job`}
          value={job}
          placeholder="For example: Builds pages, styles and forms"
          onChange={onJob}
        />
      </label>
      <div className={form.field}>
        <span className={form.label}>Instructions</span>
        <span className={form.hint}>{notesHint}</span>
        <PointsField
          key={id}
          label="Instructions"
          value={notes}
          placeholder={notesPlaceholder}
          addLabel="Add an instruction"
          onChange={onNotes}
        />
      </div>
    </>
  );
}

export function ModelField({
  value,
  onChange,
  note,
}: {
  value: ChipSettings;
  onChange: (settings: ChipSettings) => void;
  note?: ReactNode;
}) {
  return (
    <div className={form.field}>
      <span className={form.label}>Model</span>
      <div className={form.row}>
        <SettingsChips value={value} onChange={onChange} />
      </div>
      {note}
    </div>
  );
}
