import styles from "./Switch.module.css";

interface SwitchProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, on, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={styles.switch}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

// A named choice with a one-line hint, the switch at the end of the row.
export function SwitchRow({ label, hint, ...props }: SwitchProps & { hint: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <strong>{label}</strong>
        <span className={styles.hint}>{hint}</span>
      </span>
      <Switch label={label} {...props} />
    </div>
  );
}
