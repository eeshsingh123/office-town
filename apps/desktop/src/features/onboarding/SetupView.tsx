import type { Account, HarnessDescription, Onboarding } from "@office-town/contract";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { clearDrafts, useDraft } from "../../store/drafts.ts";
import { loadWorkspaces } from "../../store/workspaces.ts";
import appIcon from "../../ui/app-icon.svg";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import form from "../../ui/Form.module.css";
import { LATEST } from "../help/whats-new.ts";
import { DEFAULT_CHOICES, keepChoices, loadRemembered, remember } from "../new-task/choices.ts";
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
import { saveOnboarding } from "./onboarding.ts";
import styles from "./Setup.module.css";
import { findTutorialModel } from "./tutorial-model.ts";
import { startTutorial } from "./tutorial-state.ts";
import { WelcomePicture } from "./WelcomePicture.tsx";

type Purpose = NonNullable<Onboarding["purpose"]>;

const STEPS = ["Welcome", "Provider"];

// Where the user is in setup outlives a restart, as signing in to a provider can need one.
const DRAFT = "setup";

// Has free models and needs no account, so it is offered first.
const FREE_PROVIDER = "opencode";

// The provider setup starts with: the user's pick, else the free one, else the first ready.
function startingProvider(
  ready: HarnessDescription[],
  picked: string | undefined,
): HarnessDescription | undefined {
  return (
    ready.find((known) => known.harness === picked) ??
    ready.find((known) => known.harness === FREE_PROVIDER) ??
    ready[0]
  );
}

// Every new task asks before it acts until the user changes it, whether setup ran or was skipped.
// New tasks go to a new folder each (Scratch), and OpenCode starts on its free model.
async function saveSafeDefaults(harness: string | undefined): Promise<void> {
  if (useApp.getState().workspaces === undefined) await loadWorkspaces();
  const { workspaces = [], harnesses } = useApp.getState();
  const scratch = workspaces.find((workspace) => workspace.kind === "scratch");
  const safe = { ...DEFAULT_CHOICES, autonomy: "supervised" as const };
  for (const known of harnesses) {
    const unused = loadRemembered().byHarness[known.harness] === undefined;
    if (unused && known.harness !== harness) keepChoices(known.harness, safe);
  }
  if (harness === undefined) return;
  const saved = loadRemembered().byHarness[harness] ?? safe;
  const free =
    harness === FREE_PROVIDER && saved.model === undefined
      ? (await findTutorialModel(harness))?.settings.model
      : undefined;
  remember({
    harness,
    choices: { ...saved, autonomy: "supervised", ...(free === undefined ? {} : { model: free }) },
    target: SOLO,
    workspaceId: scratch?.id,
  });
}

function Welcome(props: { purpose: Purpose | undefined; onPurpose: (purpose: Purpose) => void }) {
  return (
    <>
      <div className={styles.head}>
        <img className={styles.brand} src={appIcon} alt="" />
        <h1 className={styles.title}>Welcome to Office Town</h1>
        <p className={styles.lead}>
          Tell it what you need, and a team of AI agents plans it, does it and asks you before
          anything risky.
        </p>
      </div>
      <WelcomePicture />
      <div className={styles.section}>
        <div className={styles.head}>
          <h2 className={styles.sectionTitle}>What will you use it for?</h2>
          <p className={styles.hint}>Your first task will match it.</p>
        </div>
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

interface ProvidersProps {
  starting: string | undefined;
  onPick: (harness: string) => void;
}

// The same cards as Providers (D-76): the ready ones to pick from, the rest to install or sign in.
function Providers({ starting, onPick }: ProvidersProps) {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const statuses = useHarnessStatuses({ recheckOnFocus: true });
  const [sheet, setSheet] = useState<Sheet>();
  const [more, setMore] = useState(false);
  const signIn = (harness: string) => {
    const account = defaultLogin(accounts, harness);
    setSheet(account === undefined ? undefined : { kind: "sign-in", account });
  };
  const ready = harnesses
    .filter((known) => isReady(statuses?.[known.harness]))
    .toSorted((a, b) => Number(b.harness === FREE_PROVIDER) - Number(a.harness === FREE_PROVIDER));
  const others = harnesses.filter((known) => !ready.includes(known));
  // With nothing ready, the free provider is offered on its own and the rest are folded.
  const recommended =
    ready.length === 0 ? others.find((known) => known.harness === FREE_PROVIDER) : undefined;
  const folded = others.filter((known) => known !== recommended);
  const card = (description: HarnessDescription) => (
    <ProviderCard
      key={description.harness}
      description={description}
      status={statuses?.[description.harness]}
      brief
      {...(description.harness === FREE_PROVIDER ? { tag: "Free models" } : {})}
      pick={{
        checked: description.harness === starting,
        onPick: () => onPick(description.harness),
      }}
      onInstall={() => setSheet({ kind: "install", harness: description.harness })}
      onSignIn={() => signIn(description.harness)}
    />
  );
  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.title}>Choose a provider</h1>
        <p className={styles.lead}>
          A provider is the AI app your agents run on, like Claude Code or Codex. Pick one to start
          with; you can add more later in Providers.
        </p>
      </div>
      {statuses === undefined ? (
        <p className={styles.lead} role="status">
          <LoaderCircle size={14} className="spin" aria-hidden /> Checking this computer
        </p>
      ) : (
        <div className={styles.section} aria-live="polite">
          {ready.length > 0 ? (
            <ul className={styles.apps} aria-label="Ready on this computer">
              {ready.map(card)}
            </ul>
          ) : (
            <p className={styles.lead}>
              None is ready on this computer yet.
              {recommended === undefined
                ? " Install one below."
                : ` Start free with ${recommended.name}: it needs no account.`}
            </p>
          )}
          {recommended === undefined ? null : <ul className={styles.apps}>{card(recommended)}</ul>}
          {folded.length === 0 ? null : (
            <div className={styles.more}>
              <button
                type="button"
                className={styles.moreButton}
                aria-expanded={more}
                onClick={() => setMore(!more)}
              >
                <ChevronDown size={15} className={more ? undefined : styles.closed} aria-hidden />
                More providers ({folded.length})
              </button>
              <Button
                variant="ghost"
                onClick={() => void checkHarnesses({ now: true }).catch(() => {})}
              >
                Check again
              </Button>
            </div>
          )}
          {more ? <ul className={styles.apps}>{folded.map(card)}</ul> : null}
        </div>
      )}
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

// First run: what the app does and a provider to run on, then straight into a first real task.
// Everything else has a safe default the user can change later.
export function SetupView() {
  const [step, setStep] = useDraft(`${DRAFT}.step`, 0);
  const [purpose, setPurpose] = useDraft<Purpose | undefined>(`${DRAFT}.purpose`, undefined);
  const [picked, setPicked] = useDraft<string | undefined>(`${DRAFT}.provider`, undefined);
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const page = useRef<HTMLElement>(null);

  // Drafts from the old four-step setup can hold a step that no longer exists.
  const shown = Math.min(step, STEPS.length - 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each step opens at its top
  useEffect(() => {
    page.current?.scrollTo({ top: 0 });
  }, [shown]);

  const ready = harnesses.filter((known) => isReady(statuses?.[known.harness]));
  const starting = startingProvider(ready, picked);

  const finish = async (firstTask: boolean) => {
    setError(undefined);
    setBusy(true);
    const harness = starting?.harness ?? loadRemembered().harness ?? harnesses[0]?.harness;
    try {
      await saveSafeDefaults(harness);
      await saveOnboarding({
        setupDone: true,
        ...(purpose === undefined ? {} : { purpose }),
        whatsNewSeen: LATEST,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
      return;
    }
    clearDrafts(DRAFT);
    if (firstTask) await startTutorial("first-task", harness);
  };

  return (
    <main ref={page} className={styles.page} aria-labelledby="setup-steps">
      <ol id="setup-steps" className={styles.steps} aria-label="Setup steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={styles.step}
            data-state={index < shown ? "done" : index === shown ? "current" : "next"}
            aria-current={index === shown ? "step" : undefined}
          >
            {index < shown ? <Check size={12} aria-label="Done" /> : null}
            {label}
          </li>
        ))}
      </ol>
      <div className={styles.column}>
        {shown === 0 ? <Welcome purpose={purpose} onPurpose={setPurpose} /> : null}
        {shown === 1 ? <Providers starting={starting?.harness} onPick={setPicked} /> : null}
        {error === undefined ? null : (
          <p className={form.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {shown === 0 ? (
            <Button variant="ghost" disabled={busy} onClick={() => void finish(false)}>
              Skip setup
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => setStep(0)}>
              Back
            </Button>
          )}
          {shown === 0 ? (
            <Button variant="primary" onClick={() => setStep(1)}>
              Get started
            </Button>
          ) : (
            <span className={styles.end}>
              {statuses !== undefined && starting === undefined ? (
                <span className={styles.hint}>Connect a provider to start a task.</span>
              ) : null}
              <Button variant="ghost" disabled={busy} onClick={() => void finish(false)}>
                Go to Home
              </Button>
              <Button
                variant="primary"
                disabled={starting === undefined || busy}
                onClick={() => void finish(true)}
              >
                {busy ? (
                  <>
                    <LoaderCircle size={14} className="spin" aria-hidden /> Getting ready
                  </>
                ) : (
                  "Start my first task"
                )}
              </Button>
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
