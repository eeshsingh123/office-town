import type { ConnectorAction } from "@office-town/contract";
import { useState } from "react";
import { SearchBox } from "../../ui/SearchBox.tsx";
import styles from "./Connectors.module.css";

const FIRST = 8;
const SEARCH_FROM = 10;

function ActionGroup({ title, list }: { title: string; list: ConnectorAction[] }) {
  const [all, setAll] = useState(false);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <div className={styles.actionPanel}>
      <p className={styles.actionsHead}>
        {title} · {list.length}
      </p>
      <ul className={styles.actionList}>
        {shown.map((action) => (
          <li key={action.name}>
            <code className={styles.actionName}>{action.name}</code>
            {action.description === undefined ? null : (
              <span className={styles.actionText} title={action.description}>
                {action.description}
              </span>
            )}
          </li>
        ))}
        {shown.length < list.length ? (
          <li>
            <button type="button" className={styles.textLink} onClick={() => setAll(true)}>
              Show all {list.length}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// What an app offers, reads apart from changes (D-96), each in name order.
export function ActionGroups({ actions }: { actions: ConnectorAction[] }) {
  const [query, setQuery] = useState("");
  if (actions.length === 0) {
    return <p className={styles.hint}>Its actions show once an agent uses it.</p>;
  }
  const words = query.trim().toLowerCase();
  const found = actions
    .filter((action) => `${action.name} ${action.description ?? ""}`.toLowerCase().includes(words))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={styles.actionsBlock}>
      {actions.length > SEARCH_FROM ? (
        <SearchBox value={query} onChange={setQuery} label="Search actions" />
      ) : null}
      {found.length === 0 ? (
        <p className={styles.hint}>No action matches.</p>
      ) : (
        <div className={styles.actions} key={words}>
          <ActionGroup title="Reads" list={found.filter(({ readOnly }) => readOnly)} />
          <ActionGroup title="Changes" list={found.filter(({ readOnly }) => !readOnly)} />
        </div>
      )}
    </div>
  );
}
