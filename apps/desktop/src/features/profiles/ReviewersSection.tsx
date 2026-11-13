import type { ReviewerRecord } from "@office-town/contract";
import { Eye, Plus } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { useReviewers } from "../../store/reviewers.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { useModels } from "./model-line.ts";
import { modelLine } from "./model-name.ts";
import { ReviewerDialog } from "./ReviewerDialog.tsx";
import styles from "./Templates.module.css";

export const NO_MODEL_YET = "Model picked at first use";

// Saved reviewers sit beside the agent templates: each can review any task.
export function ReviewersSection() {
  const harnesses = useApp((state) => state.harnesses);
  const reviewers = useReviewers();
  const all = reviewers ?? [];
  const modelsOf = useModels(all.flatMap((reviewer) => reviewer.settings ?? []));
  const [editing, setEditing] = useState<{ reviewer: ReviewerRecord | undefined; key: number }>();
  const open = (reviewer: ReviewerRecord | undefined) =>
    setEditing({ reviewer, key: (editing?.key ?? 0) + 1 });

  return (
    <section className={styles.section} aria-labelledby="reviewers-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="reviewers-title" className={styles.sectionTitle}>
            Reviewers
          </h2>
          <p className={form.hint}>
            {all.length === 1 ? "1 reviewer" : `${all.length} reviewers`}. Pick one when you send a
            task for review.
          </p>
        </div>
        <Button variant="secondary" onClick={() => open(undefined)}>
          <Plus size={14} aria-hidden />
          New reviewer
        </Button>
      </div>
      {reviewers === undefined ? (
        <p className={form.hint}>Loading reviewers…</p>
      ) : all.length === 0 ? (
        <div className={styles.empty}>
          <strong>No reviewers yet</strong>
          <p className={form.hint}>A reviewer checks a finished task the way you set it up.</p>
        </div>
      ) : (
        <ul className={styles.grid} aria-label="Reviewers">
          {all.map((reviewer) => (
            <li key={reviewer.id} className={styles.card}>
              <button
                type="button"
                className={styles.cardBody}
                aria-label={`Edit ${reviewer.name}`}
                onClick={() => open(reviewer)}
              >
                <span className={styles.cardTop}>
                  <span className={styles.reviewerIcon}>
                    <Eye size={16} aria-hidden />
                  </span>
                  <span className={styles.cardText}>
                    <strong>{reviewer.name}</strong>
                    <span className={styles.job}>{reviewer.description}</span>
                  </span>
                </span>
                <span className={styles.overview}>
                  {reviewer.settings === undefined
                    ? NO_MODEL_YET
                    : modelLine(reviewer.settings, harnesses, modelsOf(reviewer.settings))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing === undefined ? null : (
        <ReviewerDialog
          key={editing.key}
          reviewer={editing.reviewer}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
