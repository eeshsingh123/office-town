import type { HarnessDescription, HarnessStatus } from "@office-town/contract";
import { BadgeCheck, Check } from "lucide-react";
import { Button } from "../../ui/Button.tsx";
import { Pill } from "../../ui/Pill.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { isReady } from "./providers.ts";

interface ProviderCardProps {
  description: HarnessDescription;
  status: HarnessStatus | undefined;
  // Setup's cards leave the one-line summary out.
  brief?: boolean;
  // Setup picks the provider to start with from the ready cards.
  pick?: { checked: boolean; onPick: () => void };
  // A short tag beside the name, such as "Free models".
  tag?: string;
  onInstall: () => void;
  onSignIn: () => void;
}

// One AI app with what it takes and the one step that gets it ready: on Providers and in setup.
export function ProviderCard({
  description,
  status,
  brief,
  pick,
  tag,
  onInstall,
  onSignIn,
}: ProviderCardProps) {
  const ready = isReady(status);
  const picking = pick !== undefined && ready;
  const body = (
    <>
      <div className={styles.cardTop}>
        <ProviderLogo harness={description.harness} />
        {ready ? (
          <Pill tone="ok">
            <Check size={12} aria-hidden /> Ready
          </Pill>
        ) : status?.installed ? (
          <Pill tone="warn">Not signed in</Pill>
        ) : status === undefined ? (
          <span className={styles.muted}>Checking</span>
        ) : null}
      </div>
      <span className={styles.cardName}>
        <span className={styles.cardTitle}>
          {description.name}
          {tag === undefined ? null : <span className={styles.cardTag}>{tag}</span>}
        </span>
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
    </>
  );
  if (picking) {
    return (
      <li>
        <label className={`${styles.card} ${styles.cardReady} ${styles.cardPick}`}>
          {body}
          <input
            type="radio"
            name="start-provider"
            className={styles.cardRadio}
            checked={pick.checked}
            onChange={pick.onPick}
          />
        </label>
      </li>
    );
  }
  return <li className={`${styles.card} ${ready ? styles.cardReady : ""}`}>{body}</li>;
}
