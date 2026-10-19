import { useApp } from "../../store/app-store.ts";
import { useTheme } from "../../ui/theme.ts";
import styles from "./Connectors.module.css";
import { DEEP, LOGOS } from "./logos.ts";

interface AppLogoProps {
  // A slug, or an app's name as an agent wrote it.
  app: string;
  size?: "sm" | "md" | "lg";
}

// The app's own logo on a tile, or its first letter.
export function AppLogo({ app, size = "md" }: AppLogoProps) {
  const dark = useTheme() === "dark";
  const connector = useApp((state) =>
    Object.values(state.connectors).find(
      ({ setup }) => setup.slug === app || setup.name.toLowerCase() === app.toLowerCase(),
    ),
  );
  // A Claude app's slug is "claude-notion", so its logo is found by its name.
  const slug =
    connector?.setup.kind === "claude"
      ? connector.setup.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")
      : (connector?.setup.slug ?? app);
  const logo = LOGOS[slug];
  const name = connector?.setup.name ?? app;
  return (
    <span
      className={`${styles.logo} ${styles[size]} ${dark && DEEP.has(slug) ? styles.deep : ""}`}
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
