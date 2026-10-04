import { useApp } from "../../store/app-store.ts";
import styles from "./ConnectionStatus.module.css";

// Says so only when something is wrong; a working connection needs no label.
export function ConnectionStatus() {
  const connection = useApp((state) => state.connection);
  if (connection === "live") return null;
  return (
    <p className={styles.status} role="status">
      <span className={styles.dot} aria-hidden />
      {connection === "connecting" ? "Connecting to the core…" : "Reconnecting to the core…"}
    </p>
  );
}
