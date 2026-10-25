import { useApp } from "../../store/app-store.ts";
import { useTheme } from "../../ui/theme.ts";
import styles from "./Providers.module.css";
import { DEEP, LOGOS } from "./providers.ts";

// An AI app's mark on a tile, or its first letter.
export function ProviderLogo({
  harness,
  size = "md",
}: {
  harness: string;
  size?: "sm" | "md" | "lg";
}) {
  const dark = useTheme() === "dark";
  const name = useApp(
    (state) => state.harnesses.find((known) => known.harness === harness)?.name ?? harness,
  );
  const logo = LOGOS[harness];
  return (
    <span
      className={`${styles.logo} ${styles[size]} ${dark && DEEP.has(harness) ? styles.deep : ""}`}
      role="img"
      aria-label={name}
    >
      {logo === undefined ? (
        <span className={styles.letter} aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <img src={logo} alt="" draggable={false} />
      )}
    </span>
  );
}
