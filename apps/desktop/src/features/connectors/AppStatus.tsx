import styles from "./Connectors.module.css";
import type { AppState } from "./connectors.ts";

const WORDS: Record<AppState, string> = {
  ready: "Ready",
  renew: "Needs renewing",
  failing: "Not answering",
  off: "Turned off",
  offer: "Not set up",
};

// The one way an app's status reads: amber and red need the user, grey is the user's own choice.
export function AppStatus({ state }: { state: AppState }) {
  return (
    <span className={`${styles.state} ${styles[`state-${state}`]}`}>
      <i aria-hidden />
      {WORDS[state]}
    </span>
  );
}
