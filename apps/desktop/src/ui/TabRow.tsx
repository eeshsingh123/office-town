import styles from "./TabRow.module.css";

export interface Tab<T extends string> {
  value: T;
  label: string;
  // Blank until it is known, rather than a wrong number.
  count?: number | undefined;
  // Amber, for what needs the user.
  urgent?: boolean;
}

// The one row of underlined tabs with counts, for lists that split by status or kind.
export function TabRow<T extends string>(props: {
  label: string;
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={props.label}>
      {props.tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={props.value === tab.value}
          className={styles.tab}
          onClick={() => props.onChange(tab.value)}
        >
          {tab.label}
          <span className={tab.urgent === true ? styles.urgent : styles.count}>{tab.count}</span>
        </button>
      ))}
    </div>
  );
}
