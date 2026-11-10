import { useEffect, useState } from "react";
import { shell } from "../../shell.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { startTutorial } from "../onboarding/tutorial-state.ts";
import { TUTORIALS } from "../onboarding/tutorials.ts";
import styles from "./Help.module.css";
import { ReleaseList } from "./Releases.tsx";
import { LATEST, RELEASES } from "./whats-new.ts";

const RECENT_RELEASES = 3;

function Tutorials() {
  const state = useApp();
  return (
    <section className={styles.card} aria-labelledby="help-tutorials">
      <h2 id="help-tutorials" className={styles.cardTitle}>
        Tutorials
      </h2>
      <ul className={styles.list}>
        {TUTORIALS.map((tutorial) => {
          const blocked = tutorial.blocked?.(state);
          return (
            <li key={tutorial.id} className={styles.row}>
              <span className={styles.rowText}>
                <strong>{tutorial.title}</strong>
                <span>{blocked ?? tutorial.summary}</span>
              </span>
              <Button
                disabled={blocked !== undefined}
                onClick={() => void startTutorial(tutorial.id)}
              >
                Start
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function useAppVersion(): string | undefined {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    void shell?.appVersion().then(setVersion);
  }, []);
  return version;
}

function WhatsNew() {
  const version = useAppVersion();
  const [showAll, setShowAll] = useState(false);
  const earlier = RELEASES.length - RECENT_RELEASES;
  return (
    <section className={styles.card} aria-labelledby="help-new">
      <div className={styles.cardHead}>
        <h2 id="help-new" className={styles.cardTitle}>
          What's new
        </h2>
        {version === undefined ? null : <span className={styles.version}>Version {version}</span>}
      </div>
      <ReleaseList
        releases={showAll ? RELEASES : RELEASES.slice(0, RECENT_RELEASES)}
        latest={LATEST}
      />
      {earlier > 0 ? (
        <Button
          variant="ghost"
          className={styles.more}
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show ${earlier} earlier updates`}
        </Button>
      ) : null}
    </section>
  );
}

export function HelpView() {
  return (
    <section className={styles.page} aria-labelledby="help-title">
      <div className={styles.column}>
        <div className={styles.head}>
          <h1 id="help-title" className={styles.title}>
            Help
          </h1>
          <Button onClick={() => void saveOnboarding({ setupDone: false })}>Run setup again</Button>
        </div>
        <Tutorials />
        <WhatsNew />
      </div>
    </section>
  );
}
