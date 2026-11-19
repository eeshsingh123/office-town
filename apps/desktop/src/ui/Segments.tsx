import styles from "./Segments.module.css";

interface SegmentsProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

// A choice of two or three, side by side, the picked one raised.
export function Segments<T extends string>({ label, value, options, onChange }: SegmentsProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: pressed buttons, as the chips elsewhere
    <div role="group" aria-label={label} className={styles.segments}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            if (value !== option.value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
