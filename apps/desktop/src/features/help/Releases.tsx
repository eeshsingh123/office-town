import styles from "./Releases.module.css";
import type { Release } from "./whats-new.ts";

const DAY = new Intl.DateTimeFormat([], { day: "numeric", month: "short", year: "numeric" });

// A timeline of releases, newest first; the latest one is marked.
export function ReleaseList({ releases, latest }: { releases: Release[]; latest: string }) {
  return (
    <ol className={styles.timeline}>
      {releases.map(({ date, title, icon: Icon, changes }) => (
        <li key={date} className={styles.release}>
          <span className={styles.marker} data-latest={date === latest || undefined}>
            <Icon size={15} aria-hidden />
          </span>
          <div className={styles.body}>
            <div className={styles.head}>
              <h3 className={styles.title}>{title}</h3>
              {date === latest ? <span className={styles.badge}>Latest</span> : null}
              <time className={styles.date} dateTime={date}>
                {DAY.format(new Date(`${date}T00:00:00`))}
              </time>
            </div>
            <ul className={styles.changes}>
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
