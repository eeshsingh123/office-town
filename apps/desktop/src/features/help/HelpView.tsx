import { useEffect, useState } from "react";
import { shell } from "../../shell.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmButton } from "../../ui/ConfirmDialog.tsx";
import { FoldedGuide } from "../../ui/Guide.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { backKeys, forwardKeys, isMac, shortcut } from "../../ui/system.ts";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { TutorialList } from "../onboarding/TutorialList.tsx";
import { TEMPLATE_STEPS } from "../profiles/TemplatesGuide.tsx";
import { CHIEF_STEPS, DEPARTMENT_STEPS } from "../team/guides.tsx";
import styles from "./Help.module.css";
import { ReleaseList } from "./Releases.tsx";
import { LATEST, RELEASES } from "./whats-new.ts";

const RECENT_RELEASES = 3;

function Tutorials() {
  return (
    <section className={page.panel} aria-labelledby="help-tutorials">
      <h2 id="help-tutorials" className={page.sectionTitle}>
        Tutorials
      </h2>
      <TutorialList />
      <div>
        <ConfirmButton
          variant="ghost"
          ask={{
            title: "Run setup again?",
            description: "The setup steps replace the app until you finish or skip them.",
            confirmLabel: "Run setup",
            run: () => saveOnboarding({ setupDone: false }),
          }}
        >
          Run setup again
        </ConfirmButton>
      </div>
    </section>
  );
}

// The pictured steps once at the top of Department settings, Templates and the chief (a2-31).
function HowItWorks() {
  return (
    <section className={page.panel} aria-labelledby="help-how">
      <h2 id="help-how" className={page.sectionTitle}>
        How it works
      </h2>
      <FoldedGuide title="How a department works" steps={DEPARTMENT_STEPS} columns={2} />
      <FoldedGuide title="How your chief works" steps={CHIEF_STEPS} columns={2} />
      <FoldedGuide title="How templates work" steps={TEMPLATE_STEPS} columns={3} />
    </section>
  );
}

const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: shortcut("N"), does: "New task" },
  { keys: shortcut("K"), does: "Search" },
  { keys: shortcut("B"), does: "Show or hide the sidebar" },
  { keys: `${backKeys} / ${forwardKeys}`, does: "Back and forward" },
  { keys: "F1", does: "Help" },
  { keys: shortcut(","), does: "Settings" },
  { keys: "@", does: "In a task: choose who does it, or tag an app" },
  { keys: "#", does: "In a task: add a Library file" },
  { keys: "/", does: "In a task: use a template" },
  { keys: "Shift Enter", does: "In a task: a new line" },
];

function Shortcuts() {
  return (
    <section className={page.panel} aria-labelledby="help-keys">
      <h2 id="help-keys" className={page.sectionTitle}>
        Keyboard shortcuts
      </h2>
      <dl className={styles.keys}>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className={styles.key}>
            <dt>
              <Kbd>{shortcut.keys}</Kbd>
            </dt>
            <dd>{shortcut.does}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const ON_A_MAC: { topic: string; answer: string }[] = [
  {
    topic: "It won't open",
    answer:
      "The first time, macOS may say it can't check the app. Open System Settings > Privacy & Security and choose Open Anyway.",
  },
  {
    topic: "Applications",
    answer:
      "Keep Office Town in your Applications folder. It offers to move itself the first time.",
  },
  {
    topic: "Folders",
    answer:
      "macOS asks before the app opens Documents, Desktop, Downloads, iCloud Drive or an outside disk. To change your answer, go to System Settings > Privacy & Security > Files and Folders.",
  },
  {
    topic: "Claude usage",
    answer:
      "Usage is read from Claude's sign-in in your Keychain, never changed. If macOS asks, choose Always Allow.",
  },
  {
    topic: "Updates",
    answer:
      "This test version can't update itself. When a new version is ready, download it and replace the app.",
  },
];

function OnAMac() {
  if (!isMac) return null;
  return (
    <section className={page.panel} aria-labelledby="help-mac">
      <h2 id="help-mac" className={page.sectionTitle}>
        On a Mac
      </h2>
      <dl className={styles.keys}>
        {ON_A_MAC.map(({ topic, answer }) => (
          <div key={topic} className={styles.key}>
            <dt>{topic}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
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
    <section className={page.panel} aria-labelledby="help-new">
      <div className={styles.cardHead}>
        <h2 id="help-new" className={page.sectionTitle}>
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
    <section className={page.page} aria-labelledby="help-title">
      <div className={page.form}>
        <PageHeader id="help-title" title="Help" />
        <Tutorials />
        <HowItWorks />
        <WhatsNew />
        <Shortcuts />
        <OnAMac />
      </div>
    </section>
  );
}
