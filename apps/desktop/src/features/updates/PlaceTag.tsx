import type { DestinationKind, DestinationRecord } from "@office-town/contract";
import { Monitor } from "lucide-react";
import { AppLogo } from "../connectors/AppLogo.tsx";
import { GUIDES } from "./guides/all.ts";
import styles from "./Updates.module.css";

// A service's logo, or the icon of a way that has none.
export function ServiceLogo({ kind, size = "xs" }: { kind: DestinationKind; size?: "xs" | "md" }) {
  const { logo, label } = GUIDES[kind];
  if (typeof logo === "string") return <AppLogo app={logo} size={size} />;
  const Icon = logo;
  return (
    <span className={`${styles.iconLogo} ${styles[size]}`} role="img" aria-label={label}>
      <Icon size={size === "md" ? 18 : 12} aria-hidden />
    </span>
  );
}

// Every connected app is named the same way: its logo and its name, in plain text.
export function PlaceTag({ place }: { place: DestinationRecord }) {
  return (
    <span className={styles.tag} title={`${place.name} · ${GUIDES[place.settings.kind].label}`}>
      <ServiceLogo kind={place.settings.kind} />
      {place.name}
    </span>
  );
}

export function ComputerTag() {
  return (
    <span className={styles.tag}>
      <span className={`${styles.iconLogo} ${styles.xs}`} aria-hidden>
        <Monitor size={12} />
      </span>
      This computer
    </span>
  );
}

// Connected apps in the order given.
export function PlaceTags({ places }: { places: readonly DestinationRecord[] }) {
  return (
    <span className={styles.tags}>
      {places.map((place) => (
        <PlaceTag key={place.id} place={place} />
      ))}
    </span>
  );
}
