import styles from "./Releases.module.css";
import { type Release, releaseKey } from "./whats-new.ts";

const DAY = new Intl.DateTimeFormat([], { day: "numeric", month: "short", year: "numeric" });

// A timeline of releases, newest first; the latest one is marked.
export function ReleaseList({ releases, latest }: { releases: Release[]; latest: string }) {
  return (
    <ol className={styles.timeline}>
      {releases.map((release) => {
        const { date, title, icon: Icon, changes } = release;
        const isLatest = releaseKey(release) === latest;
        return (
          <li key={releaseKey(release)} className={styles.release}>
            <span className={styles.marker} data-latest={isLatest || undefined}>
              <Icon size={15} aria-hidden />
            </span>
            <div className={styles.body}>
              <div className={styles.head}>
                <h3 className={styles.title}>{title}</h3>
                {isLatest ? <span className={styles.badge}>Latest</span> : null}
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
        );
      })}
    </ol>
  );
}
