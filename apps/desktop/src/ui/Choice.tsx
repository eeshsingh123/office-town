import type { ReactNode } from "react";
import styles from "./Choice.module.css";

export interface CardOption<T extends string> {
  value: T;
  title: string;
  best: string;
  detail: string;
  icon: ReactNode;
}

interface OptionCardsProps<T extends string> {
  name: string;
  label: string;
  value: T;
  options: readonly CardOption<T>[];
  onChange: (value: T) => void;
}

// Large choices with a picture, for the one decision a page is about.
export function OptionCards<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: OptionCardsProps<T>) {
  return (
    <fieldset className={styles.cards}>
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={styles.card}
          data-selected={value === option.value || undefined}
        >
          <input
            type="radio"
            name={name}
            className="visually-hidden"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.cardIcon} aria-hidden>
            {option.icon}
          </span>
          <span className={styles.cardTitle}>{option.title}</span>
          <span className={styles.best}>{option.best}</span>
          <span className={styles.detail}>{option.detail}</span>
        </label>
      ))}
    </fieldset>
  );
}

export interface RowOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  suggested?: boolean;
  disabled?: boolean;
  aside?: ReactNode;
}

interface OptionRowsProps<T extends string> {
  name: string;
  label: string;
  value: T | undefined;
  options: readonly RowOption<T>[];
  onChange: (value: T) => void;
  wide?: boolean;
}

export function OptionRows<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  wide = false,
}: OptionRowsProps<T>) {
  return (
    <fieldset className={`${styles.rows} ${wide ? styles.rowsWide : ""}`}>
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={styles.row}
          data-selected={value === option.value || undefined}
        >
          <input
            type="radio"
            name={name}
            className="visually-hidden"
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.radio} aria-hidden />
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>
              {option.title}
              {option.suggested ? <span className={styles.tag}>Suggested</span> : null}
            </span>
            {option.description === undefined ? null : (
              <span className={styles.detail}>{option.description}</span>
            )}
          </span>
          {option.aside}
        </label>
      ))}
    </fieldset>
  );
}

export function MoreButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={styles.more} onClick={onClick}>
      {children}
    </button>
  );
}
