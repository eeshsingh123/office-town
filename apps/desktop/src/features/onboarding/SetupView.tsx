import type { Account, Autonomy, Onboarding } from "@office-town/contract";
import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { loadWorkspaces, useWorkspaces } from "../../store/workspaces.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import { FolderField } from "../../ui/FolderField.tsx";
import form from "../../ui/Form.module.css";
import { PointsField } from "../../ui/PointsField.tsx";
import { LATEST } from "../help/whats-new.ts";
import { DEFAULT_CHOICES, loadRemembered, remember } from "../new-task/choices.ts";
import { SOLO } from "../new-task/targets.ts";
import { InstallSheet } from "../providers/InstallSheet.tsx";
import { ProviderCard } from "../providers/ProviderCard.tsx";
import {
  checkHarnesses,
  defaultLogin,
  isReady,
  useHarnessStatuses,
} from "../providers/providers.ts";
import { AddAccountDialog } from "../usage/AddAccountDialog.tsx";
import { DEFAULT_YOU, useYou } from "../you/you.ts";
import { saveOnboarding } from "./onboarding.ts";
import styles from "./Setup.module.css";
import { startTutorial } from "./tutorial-state.ts";
import { TUTORIALS } from "./tutorials.ts";

type Purpose = NonNullable<Onboarding["purpose"]>;
type Where = "scratch" | "folder";

const STEPS = ["Welcome", "AI app", "Your work", "Ready"];

function finish(purpose: Purpose | undefined) {
  return saveOnboarding({
    setupDone: true,
    ...(purpose === undefined ? {} : { purpose }),
    whatsNewSeen: LATEST,
  });
}

function Welcome(props: { purpose: Purpose | undefined; onPurpose: (purpose: Purpose) => void }) {
  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>Welcome to Office Town</h1>
        <p className={styles.lead}>
          Describe a task and AI agents do it on your computer. They ask you before anything
          important.
        </p>
      </div>
      <ul className={styles.ways}>
        <li className={styles.way}>
          <strong>Assistant</strong>
          <span>One agent for one task.</span>
        </li>
        <li className={styles.way}>
          <strong>Department</strong>
          <span>A team with a lead, for work you do often, like a website or marketing.</span>
        </li>
        <li className={styles.way}>
          <strong>Chief</strong>
          <span>Splits a big goal across your departments.</span>
        </li>
      </ul>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>What will you use it for?</h2>
        <OptionRows
          name="purpose"
          label="What will you use it for?"
          value={props.purpose}
          wide
          options={[
            { value: "software", title: "Building software" },
            { value: "business", title: "Running a team or a business" },
            { value: "exploring", title: "Just trying it out" },
          ]}
          onChange={props.onPurpose}
        />
      </div>
    </>
  );
}

type Sheet = { kind: "install"; harness: string } | { kind: "sign-in"; account: Account };

// The same cards as Providers: each app ready, to sign in, or to install (D-76).
function AiApps() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const statuses = useHarnessStatuses();
  const [sheet, setSheet] = useState<Sheet>();
  const signIn = (harness: string) => {
    const account = defaultLogin(accounts, harness);
    setSheet(account === undefined ? undefined : { kind: "sign-in", account });
  };
  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>Pick your AI apps</h1>
        <p className={styles.lead}>
          Your agents run on an AI app on this computer. They need at least one; you can add more
          later in Providers.
        </p>
      </div>
      {statuses === undefined ? (
        <p className={styles.lead}>Checking this computer…</p>
      ) : (
        <ul className={styles.apps} aria-live="polite">
          {harnesses.map((description) => (
            <ProviderCard
              key={description.harness}
              description={description}
              status={statuses[description.harness]}
              brief
              onInstall={() => setSheet({ kind: "install", harness: description.harness })}
              onSignIn={() => signIn(description.harness)}
            />
          ))}
        </ul>
      )}
      <div>
        <Button onClick={() => void checkHarnesses({ now: true }).catch(() => {})}>
          Check again
        </Button>
      </div>
      {sheet?.kind === "install" ? (
        <InstallSheet
          harness={sheet.harness}
          onSignIn={() => signIn(sheet.harness)}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet?.kind === "sign-in" ? (
        <AddAccountDialog again={sheet.account} onClose={() => setSheet(undefined)} />
      ) : null}
    </>
  );
}

interface YourWorkProps {
  where: Where;
  folder: string;
  name: string;
  about: string;
  autonomy: Autonomy;
  onChange: (change: Partial<Omit<YourWorkProps, "onChange">>) => void;
}

function YourWork(props: YourWorkProps) {
  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>Your work</h1>
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Where should agents save their work?</h2>
        <OptionRows
          name="where"
          label="Where should agents save their work?"
          value={props.where}
          options={[
            {
              value: "scratch",
              title: "A new folder for each task",
              description: "Your own files stay untouched.",
              suggested: true,
            },
            {
              value: "folder",
              title: "A folder on this computer",
              description: "Agents work inside a project or documents folder you pick.",
            },
          ]}
          onChange={(where) => props.onChange({ where })}
        />
        {props.where === "folder" ? (
          <FolderField
            label="Folder"
            value={props.folder}
            onChange={(folder) => props.onChange({ folder })}
          />
        ) : null}
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Should agents ask before they act?</h2>
        <OptionRows
          name="autonomy"
          label="Should agents ask before they act?"
          value={props.autonomy}
          options={(["supervised", "full"] as const).map((level) => ({
            value: level,
            title: AUTONOMY[level].label,
            description: AUTONOMY[level].description,
          }))}
          onChange={(autonomy) => props.onChange({ autonomy })}
        />
      </div>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>About you (optional)</h2>
        <div className={form.field}>
          <label className={form.label} htmlFor="setup-name">
            Your name
          </label>
          <input
            id="setup-name"
            className={form.input}
            value={props.name}
            onChange={(change) => props.onChange({ name: change.target.value })}
          />
        </div>
        <div className={form.field}>
          <span className={form.label}>About you and your work</span>
          <span className={form.hint}>Every agent reads this.</span>
          <PointsField
            label="About you and your work"
            value={props.about}
            placeholder="For example: I run marketing at a small bakery"
            addLabel="Add a point"
            onChange={(about) => props.onChange({ about })}
          />
        </div>
      </div>
    </>
  );
}

function Ready({ onStart }: { onStart: (tutorial: string | undefined) => void }) {
  const state = useApp();
  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>You're ready</h1>
        <p className={styles.lead}>
          Try a short tutorial. It does real work on a low-cost model, and you can stop any time.
        </p>
      </div>
      <ul className={styles.tutorials}>
        {TUTORIALS.map((tutorial) => {
          const blocked = tutorial.blocked?.(state);
          return (
            <li key={tutorial.id} className={styles.tutorial}>
              <span className={styles.appText}>
                <strong>{tutorial.title}</strong>
                <span>{blocked ?? tutorial.summary}</span>
              </span>
              <Button disabled={blocked !== undefined} onClick={() => onStart(tutorial.id)}>
                Start
              </Button>
            </li>
          );
        })}
      </ul>
      <p className={styles.lead}>Tutorials stay in Help.</p>
    </>
  );
}

// First run: what the app does, an AI app to run on, where work goes, then a tutorial.
export function SetupView() {
  const you = useYou();
  useWorkspaces();
  const [step, setStep] = useState(0);
  const [purpose, setPurpose] = useState<Purpose>();
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  const [work, setWork] = useState<Omit<YourWorkProps, "onChange">>({
    where: "scratch",
    folder: "",
    name: you.name,
    about: you.about,
    autonomy: "supervised",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ready = harnesses.filter((known) => isReady(statuses?.[known.harness]));
  const anyReady = ready.length > 0;
  const canContinue =
    (step !== 1 || anyReady) && (step !== 2 || work.where === "scratch" || work.folder !== "");

  const saveWork = async () => {
    if (useApp.getState().workspaces === undefined) await loadWorkspaces();
    const workspaces = useApp.getState().workspaces ?? [];
    let workspaceId = workspaces.find((workspace) => workspace.kind === "scratch")?.id;
    if (work.where === "folder") {
      const folderName = work.folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "My folder";
      const created = await api.createWorkspace({
        name: folderName,
        kind: "folders",
        folders: [{ path: work.folder, access: "edit" }],
      });
      await loadWorkspaces();
      workspaceId = created.id;
    }
    const harness = ready[0]?.harness ?? loadRemembered().harness;
    if (harness !== undefined) {
      const saved = loadRemembered().byHarness[harness] ?? DEFAULT_CHOICES;
      remember({
        harness,
        choices: { ...saved, autonomy: work.autonomy },
        target: SOLO,
        workspaceId,
      });
    }
    if (work.name !== you.name || work.about !== you.about) {
      const saved = await api.saveYou({
        ...DEFAULT_YOU,
        ...you,
        name: work.name,
        about: work.about,
      });
      useApp.setState({ you: saved });
    }
  };

  const next = async () => {
    setError(undefined);
    if (step === 2) {
      setBusy(true);
      try {
        await saveWork();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      } finally {
        setBusy(false);
      }
    }
    setStep(step + 1);
  };

  const done = async (tutorial: string | undefined) => {
    await finish(purpose);
    const picked = TUTORIALS.find((known) => known.id === tutorial);
    if (picked !== undefined) await startTutorial(picked.id);
  };

  return (
    <main className={styles.page} aria-labelledby="setup-steps">
      <ol id="setup-steps" className={styles.steps} aria-label="Setup steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={styles.step}
            data-state={index < step ? "done" : index === step ? "current" : "next"}
            aria-current={index === step ? "step" : undefined}
          >
            {index < step ? <Check size={12} aria-label="Done" /> : null}
            {label}
          </li>
        ))}
      </ol>
      <div className={styles.column}>
        {step === 0 ? <Welcome purpose={purpose} onPurpose={setPurpose} /> : null}
        {step === 1 ? <AiApps /> : null}
        {step === 2 ? (
          <YourWork {...work} onChange={(change) => setWork({ ...work, ...change })} />
        ) : null}
        {step === 3 ? <Ready onStart={(tutorial) => void done(tutorial)} /> : null}
        {error === undefined ? null : (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {step === 0 ? (
            <Button variant="ghost" onClick={() => void finish(purpose)}>
              Skip setup
            </Button>
          ) : (
            <Button onClick={() => setStep(step - 1)}>Back</Button>
          )}
          {step === 1 && statuses !== undefined && anyReady ? (
            <span className={styles.readyCount}>{ready.length} ready</span>
          ) : null}
          {step === 1 && statuses !== undefined && !anyReady ? (
            <Button variant="ghost" className={styles.later} onClick={() => setStep(2)}>
              Skip for now
            </Button>
          ) : null}
          {step === 3 ? (
            <Button variant="primary" onClick={() => void done(undefined)}>
              Go to Home
            </Button>
          ) : (
            <Button variant="primary" disabled={!canContinue || busy} onClick={() => void next()}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
