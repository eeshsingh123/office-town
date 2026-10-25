import type { HarnessDescription, HarnessStatus } from "@office-town/contract";
import { BadgeCheck, Check } from "lucide-react";
import { Button } from "../../ui/Button.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { isReady } from "./providers.ts";

interface ProviderCardProps {
  description: HarnessDescription;
  status: HarnessStatus | undefined;
  // Setup's cards leave the one-line summary out.
  brief?: boolean;
  onInstall: () => void;
  onSignIn: () => void;
}

// One AI app with what it takes and the one step that gets it ready: on Providers and in setup.
export function ProviderCard({
  description,
  status,
  brief,
  onInstall,
  onSignIn,
}: ProviderCardProps) {
  const ready = isReady(status);
  return (
    <li className={`${styles.card} ${ready ? styles.cardReady : ""}`}>
      <div className={styles.cardTop}>
        <ProviderLogo harness={description.harness} />
        {ready ? (
          <span className={`${styles.chip} ${styles.chipOk}`}>
            <Check size={12} aria-hidden /> Ready
          </span>
        ) : status?.installed ? (
          <span className={`${styles.chip} ${styles.chipWarn}`}>Not signed in</span>
        ) : null}
      </div>
      <span className={styles.cardName}>
        <span className={styles.cardTitle}>{description.name}</span>
        <span className={styles.muted}>
          <BadgeCheck size={13} aria-hidden /> Official, by {description.maker}
        </span>
      </span>
      {brief ? null : <p className={styles.summary}>{description.summary}</p>}
      <div className={styles.cardFoot}>
        <span className={styles.muted}>{description.needs}</span>
        {status === undefined || ready ? null : status.installed ? (
          <Button variant="primary" onClick={onSignIn}>
            Sign in
          </Button>
        ) : (
          <Button onClick={onInstall}>Install</Button>
        )}
      </div>
    </li>
  );
}
