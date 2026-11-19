import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import styles from "./Setup.module.css";

function Desk(props: { harness: string; job: string; doing: string; lead?: boolean }) {
  return (
    <div className={`${styles.desk} ${props.lead ? styles.deskLead : ""}`}>
      <ProviderLogo harness={props.harness} size="sm" />
      <span className={styles.deskText}>
        <strong>{props.job}</strong>
        <span>{props.doing}</span>
      </span>
    </div>
  );
}

// The product in one look: a lead hands work to teammates on other providers and the user approves the team.
export function WelcomePicture() {
  return (
    <figure className={styles.picture}>
      <Desk harness="claude" job="Lead" doing="Plans the work and hands it out" lead />
      <div className={styles.team}>
        <Desk harness="codex" job="Writer" doing="Writes the first draft" />
        <Desk harness="opencode" job="Editor" doing="Checks it and fixes typos" />
      </div>
      <div className={styles.ask}>
        <span>
          <strong>Lead asks you</strong>
          <span>Approve this team? Writer drafts, Editor checks.</span>
        </span>
        <span className={styles.askButtons} aria-hidden>
          <span className={styles.askAllow}>Approve</span>
          <span className={styles.askDeny}>Change</span>
        </span>
      </div>
      <figcaption className={styles.caption}>
        One team can mix providers, and you choose who is on it.
      </figcaption>
    </figure>
  );
}
