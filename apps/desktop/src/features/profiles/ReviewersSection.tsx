import type { ReviewerRecord } from "@office-town/contract";
import { Copy, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { deleteReviewer, saveReviewer, useReviewers } from "../../store/reviewers.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { useModels } from "./model-line.ts";
import { modelLine } from "./model-name.ts";
import { ReviewerDialog } from "./ReviewerDialog.tsx";
import styles from "./Templates.module.css";

// A search appears once the list is longer than this.
const SEARCH_FROM = 8;

// Saved reviewers sit beside the agent templates, one line each so a long list stays readable.
export function ReviewersSection() {
  const harnesses = useApp((state) => state.harnesses);
  const reviewers = useReviewers();
  const all = reviewers ?? [];
  const modelsOf = useModels(all.flatMap((reviewer) => reviewer.settings ?? []));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ reviewer: ReviewerRecord | undefined; key: number }>();
  const open = (reviewer: ReviewerRecord | undefined) =>
    setEditing({ reviewer, key: (editing?.key ?? 0) + 1 });

  const words = query.trim().toLowerCase();
  const shown =
    words === ""
      ? all
      : all.filter((reviewer) =>
          `${reviewer.name} ${reviewer.description}`.toLowerCase().includes(words),
        );

  const menuOf = (reviewer: ReviewerRecord) => ({
    actions: [
      { label: "Edit", icon: Pencil, run: () => open(reviewer) },
      {
        label: "Duplicate",
        icon: Copy,
        run: async () => {
          const { id: _, createdAt: __, ...request } = reviewer;
          await saveReviewer(undefined, { ...request, name: `${reviewer.name} copy` });
        },
      },
      {
        label: "Delete",
        icon: Trash2,
        danger: true,
        run: async () => {
          await deleteReviewer(reviewer.id);
          showToast(`Deleted “${reviewer.name}”.`);
        },
      },
    ],
  });

  return (
    <section className={styles.section} aria-labelledby="reviewers-title">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="reviewers-title" className={styles.sectionTitle}>
            Reviewers
          </h2>
          {reviewers === undefined ? null : (
            <p className={form.hint}>
              {shown.length === all.length
                ? `${all.length} ${all.length === 1 ? "reviewer" : "reviewers"}`
                : `${shown.length} of ${all.length} reviewers`}
            </p>
          )}
        </div>
        <div className={styles.headActions}>
          {all.length > SEARCH_FROM ? (
            <SearchBox value={query} onChange={setQuery} label="Search reviewers" />
          ) : null}
          <Button variant="secondary" onClick={() => open(undefined)}>
            <Plus size={14} aria-hidden />
            New reviewer
          </Button>
        </div>
      </div>
      {reviewers === undefined ? null : all.length === 0 ? (
        <div className={styles.empty}>
          <strong>No reviewers yet</strong>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <strong>No reviewers match</strong>
        </div>
      ) : (
        <ul className={styles.reviewerList} aria-label="Reviewers">
          {shown.map((reviewer) => (
            <li key={reviewer.id} className={styles.reviewerRow}>
              <button
                type="button"
                className={styles.reviewerOpen}
                aria-label={`Edit ${reviewer.name}`}
                onClick={() => open(reviewer)}
              >
                <span className={styles.reviewerIcon}>
                  <Eye size={15} aria-hidden />
                </span>
                <strong className={styles.reviewerName}>{reviewer.name}</strong>
                <span className={styles.reviewerJob}>{reviewer.description}</span>
                <span className={styles.reviewerModel}>
                  {reviewer.settings === undefined
                    ? "Same as the agent"
                    : modelLine(reviewer.settings, harnesses, modelsOf(reviewer.settings))}
                </span>
              </button>
              <MoreMenu menu={() => menuOf(reviewer)} label={`More for ${reviewer.name}`} />
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
