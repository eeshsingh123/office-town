import type { ReactNode } from "react";
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

// A named setting with an optional one-line hint, its control at the end of the row: the one row
// look on Settings and for every on and off in the app (a1-16, D-111).
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <strong>{label}</strong>
        {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function SwitchRow({ label, hint, ...props }: SwitchProps & { hint?: string }) {
  return (
    <SettingRow label={label} {...(hint === undefined ? {} : { hint })}>
      <Switch label={label} {...props} />
    </SettingRow>
  );
}
