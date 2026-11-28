import { type LucideIcon, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  // Good news (nothing waiting) in green, a failure in red; everything else is neutral.
  tone?: "neutral" | "good" | "bad";
  // A page's body, or a side pane or section inside a page.
  size?: "page" | "panel";
  // One action, only when nothing else on the page does it (Try again after a failure).
  // Creating and clearing filters already live in the page header and beside the filters.
  children?: ReactNode;
}

// What a list, pane or page shows when it has nothing: an icon, a title, one short hint.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  tone = "neutral",
  size = "page",
  children,
}: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${styles[size]} ${styles[tone]}`}>
      <span className={styles.bubble} aria-hidden>
        <Icon size={size === "page" ? 28 : 20} strokeWidth={1.75} />
      </span>
      <p className={styles.title}>{title}</p>
      {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
      {children === undefined ? null : <div className={styles.action}>{children}</div>}
    </div>
  );
}

// Search or filters found nothing; the Clear filters button sits beside the filters.
export function NoMatch({
  title = "Nothing matches these filters",
  hint = "Try other filters, or clear them above.",
  size = "page",
}: {
  title?: string;
  hint?: string;
  size?: "page" | "panel";
}) {
  return <EmptyState icon={SearchX} title={title} hint={hint} size={size} />;
}
