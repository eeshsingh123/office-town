import type { HarnessInstall } from "@office-town/contract";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ConnectorSheet } from "../connectors/SheetParts.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { checkHarnesses, isReady, useHarnessStatuses } from "./providers.ts";

const INSTALL_POLL_MS = 1000;
const STEPS = ["Install", "Sign in", "Ready"];

// The vendor's own installer, run by the core (D-75); the sheet asks how it is going.
function useInstall(harness: string, onEnded: () => void) {
  const [install, setInstall] = useState<HarnessInstall>();
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const running = install?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .readHarnessInstall(harness)
        .then((next) => {
          setInstall(next);
          if (next.state === "done") ended.current();
        })
        .catch((error: unknown) => {
          // The core restarted and lost the installer, so the app's own check says how it ended.
          if (!(error instanceof ApiRequestError) || error.status !== 404) return;
          setInstall(undefined);
          ended.current();
        });
    }, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [harness, running]);
  const start = () => {
    setInstall({ state: "running" });
    api.installHarness(harness).then(setInstall, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setInstall({ state: "failed", message });
    });
  };
  return { install, start };
}

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <Button
        onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Steps({ at }: { at: number }) {
  return (
    <ol className={styles.steps} aria-label="Steps">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={`${styles.step} ${index < at ? styles.stepDone : ""}`}
          aria-current={index === at ? "step" : undefined}
        >
          <span className={styles.stepNumber} aria-hidden>
            {index < at ? <Check size={11} strokeWidth={3} /> : index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

interface InstallSheetProps {
  harness: string;
  // Goes on to the CLI's own sign-in once it is installed.
  onSignIn: () => void;
  onClose: () => void;
}

// Install, sign in, ready: the app runs the vendor's installer where it can, else shows the command.
export function InstallSheet({ harness, onSignIn, onClose }: InstallSheetProps) {
  const description = useApp((state) => state.harnesses.find((one) => one.harness === harness));
  const status = useHarnessStatuses()?.[harness];
  const { install, start } = useInstall(harness, () => void checkHarnesses({ now: true }));
  const [checking, setChecking] = useState(false);
  const name = description?.name ?? harness;
  const installed = status?.installed === true;
  const at = !installed ? 0 : isReady(status) ? 2 : 1;
  const runsInstaller = status?.canInstall === true && install?.state !== "failed";

  const checkAgain = () => {
    setChecking(true);
    void checkHarnesses({ now: true })
      .catch(() => {})
      .finally(() => setChecking(false));
  };

  const foot =
    at === 2 ? (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    ) : at === 1 ? (
      <>
        <Button onClick={onClose}>Later</Button>
        <Button variant="primary" onClick={onSignIn}>
          Sign in
        </Button>
      </>
    ) : runsInstaller ? (
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={install?.state === "running"} onClick={start}>
          {install?.state === "running" ? "Installing…" : "Install"}
        </Button>
      </>
    ) : (
      <>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={checking} onClick={checkAgain}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      </>
    );

  return (
    <ConnectorSheet
      logo={<ProviderLogo harness={harness} />}
      title={name}
      by={description === undefined ? "" : `Official, by ${description.maker}`}
      foot={foot}
      onClose={onClose}
    >
      <Steps at={at} />
      {status === undefined ? (
        <p className={styles.muted}>Checking this computer…</p>
      ) : at === 2 ? (
        <div className={styles.note} role="status">
          <strong>{name} is ready</strong>
          <span className={styles.muted}>
            Pick it for an agent in the model menu, or in a template or team.
          </span>
        </div>
      ) : at === 1 ? (
        <div className={styles.note} role="status">
          <strong>Installed{status.version ? ` · version ${status.version}` : ""}</strong>
          <span className={styles.muted}>
            Next: sign in. {description?.needs ?? ""}. The sign-in page opens in your browser.
          </span>
        </div>
      ) : runsInstaller ? (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <strong>{install?.state === "running" ? "Installing" : `Install ${name}`}</strong>
            {status.installWith === undefined ? null : (
              <span className={styles.muted}>with {status.installWith}</span>
            )}
          </div>
          {install?.state === "running" ? (
            <>
              <div className={styles.progress} aria-hidden>
                <i />
              </div>
              <p className={styles.installLine} aria-live="polite">
                {install.line ?? "Starting…"}
              </p>
            </>
          ) : (
            <p className={styles.muted}>
              {description?.maker}'s own installer, run as it is. It takes a minute or two.
            </p>
          )}
        </section>
      ) : (
        <section className={styles.block}>
          {install?.state === "failed" ? (
            <p className={styles.error} role="alert">
              {install.message}
            </p>
          ) : null}
          {status.installNeeds === undefined ? null : (
            <p className={styles.muted}>
              The app can install it once {status.installNeeds} is on this computer. Until then, run
              the command yourself.
            </p>
          )}
          <strong>
            Run this in {navigator.userAgent.includes("Windows") ? "PowerShell" : "a terminal"}
          </strong>
          {status.installCommand === undefined ? null : (
            <CopyCommand command={status.installCommand} />
          )}
          {status.installPage === undefined ? null : (
            <a className={styles.link} href={status.installPage} target="_blank" rel="noreferrer">
              {description?.maker}'s install page
              <ExternalLink size={13} aria-hidden />
            </a>
          )}
          <div className={styles.waiting}>
            <span className={styles.dot} aria-hidden />
            <span>
              <strong>Not installed yet</strong>
              <span className={styles.muted}>Checked again when you come back to this window</span>
            </span>
          </div>
        </section>
      )}
    </ConnectorSheet>
  );
}
