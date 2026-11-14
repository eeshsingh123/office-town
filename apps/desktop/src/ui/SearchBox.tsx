import { Search } from "lucide-react";
import styles from "./SearchBox.module.css";

// The one search box, the same height and look on every page; the page decides where it sits.
export function SearchBox(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  // Only where the place opens to search, as a sheet of apps does.
  autoFocus?: boolean;
}) {
  return (
    <label className={styles.search}>
      <Search size={15} aria-hidden />
      <input
        type="search"
        value={props.value}
        placeholder={props.placeholder ?? props.label}
        aria-label={props.label}
        // biome-ignore lint/a11y/noAutofocus: only places that open to search pass it.
        autoFocus={props.autoFocus}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}
