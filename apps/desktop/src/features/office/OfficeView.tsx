import { useAgents } from "../../store/agents.ts";
import styles from "./OfficeView.module.css";

export function OfficeView() {
  const agents = useAgents();
  return (
    <section aria-labelledby="office-title" className={styles.office}>
      <header className={styles.header}>
        <h1 id="office-title">Office</h1>
        <span>{agents.length === 1 ? "1 agent" : `${agents.length} agents`}</span>
      </header>
    </section>
  );
}
