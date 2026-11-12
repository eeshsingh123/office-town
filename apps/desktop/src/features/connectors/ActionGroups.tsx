import type { ConnectorAction, ConnectorPermission } from "@office-town/contract";
import { Eye, PenLine } from "lucide-react";
import styles from "./Connectors.module.css";

// "create_page" and "pets.create_pet" read as "Create page" and "Create pet".
export function actionWords(name: string): string {
  const words = name
    .replace(/^[^.]+\./, "")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CHANGES: Record<ConnectorPermission, string> = {
  read_only: "Not allowed",
  ask: "Ask me first",
  dont_ask: "Don't ask",
};

// What an app offers in plain words, reads apart from changes (D-96).
export function ActionGroups({
  actions,
  permission,
}: {
  actions: ConnectorAction[];
  permission: ConnectorPermission;
}) {
  if (actions.length === 0) {
    return <p className={styles.hint}>Its actions show once an agent uses it.</p>;
  }
  const reads = actions.filter(({ readOnly }) => readOnly);
  const changes = actions.filter(({ readOnly }) => !readOnly);
  const group = (title: string, note: string, list: ConnectorAction[], change: boolean) =>
    list.length === 0 ? null : (
      <div>
        <p className={styles.actionsHead}>
          {title} <span>{note}</span>
        </p>
        <ul className={styles.actionList}>
          {list.map((action) => (
            <li key={action.name} title={action.description}>
              {change ? <PenLine size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
              {actionWords(action.name)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className={`${styles.list} ${styles.actions}`}>
      {group("Reads", "Never ask", reads, false)}
      {group("Changes", CHANGES[permission], changes, true)}
    </div>
  );
}
