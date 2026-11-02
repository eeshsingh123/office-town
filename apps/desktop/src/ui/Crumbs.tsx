import { Fragment } from "react";
import { navigate, type View } from "../store/app-store.ts";
import styles from "./Crumbs.module.css";

export interface Crumb {
  label: string;
  // Absent for the page itself.
  view?: View;
}

// Each part is a way up; the last names the page, unless the page's title sits right under it.
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {items.map(({ label, view }, index) => (
        <Fragment key={label}>
          {index === 0 ? null : (
            <span className={styles.separator} aria-hidden>
              /
            </span>
          )}
          {view === undefined ? (
            <span className={styles.current} aria-current="page">
              {label}
            </span>
          ) : (
            <button type="button" className={styles.link} onClick={() => navigate(view)}>
              {label}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
