import type { CSSProperties } from "react";
import { useApp } from "../../store/app-store.ts";
import styles from "./Connectors.module.css";
import { LOGOS } from "./logos.ts";

interface AppLogoProps {
  // A slug, or an app's name as an agent wrote it.
  app: string;
  size?: "sm" | "md" | "lg";
}

// The app's own logo on a tile, or its first letter.
export function AppLogo({ app, size = "md" }: AppLogoProps) {
  const connector = useApp((state) =>
    Object.values(state.connectors).find(
      ({ setup }) => setup.slug === app || setup.name.toLowerCase() === app.toLowerCase(),
    ),
  );
  const slug = connector?.setup.slug ?? app;
  const logo = LOGOS[slug];
  const name = connector?.setup.name ?? app;
  return (
    <span
      className={`${styles.logo} ${styles[size]} ${logo?.deep ? styles.deep : ""}`}
      style={logo === undefined ? undefined : ({ "--ink": logo.ink } as CSSProperties)}
      role="img"
      aria-label={name}
    >
      {logo === undefined ? (
        <span className={styles.letter} aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d={logo.path} />
        </svg>
      )}
    </span>
  );
}
