import { Folder, LoaderCircle, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { AppLogo } from "../connectors/AppLogo.tsx";
import styles from "./ReadyCards.module.css";

export interface ReadyCard {
  id: string;
  name: string;
  icon: LucideIcon;
  colour: string;
  description?: string;
  facts: { label: string; text: string }[];
  // What it needs before it can run: an app, shown by its logo, or else a project folder.
  needs?: { text: string; logo?: string };
}

interface ReadyCardsProps {
  title: string;
  cards: ReadyCard[];
  picked?: string | undefined;
  // Set while nothing can be picked, such as before any provider is ready.
  disabled?: boolean;
  busy?: string | undefined;
  onPick: (id: string) => void;
}

// Ready-made teams and recipes beside a Describe box: one click fills every later step.
export function ReadyCards({ title, cards, picked, disabled, busy, onPick }: ReadyCardsProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.heading}>{title}</h3>
      <div className={styles.grid}>
        {cards.map(({ icon: Icon, ...card }) => (
          <button
            key={card.id}
            type="button"
            className={styles.card}
            aria-pressed={picked === card.id}
            aria-busy={busy === card.id}
            disabled={disabled === true || busy !== undefined}
            onClick={() => onPick(card.id)}
          >
            <span className={styles.top}>
              {/* The icon turns into a spinner while the pick loads. */}
              <span
                className={styles.tile}
                style={{ "--tile": card.colour } as CSSProperties}
                aria-hidden
              >
                {busy === card.id ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Icon size={16} strokeWidth={1.8} />
                )}
              </span>
              <strong className={styles.name}>{card.name}</strong>
            </span>
            {card.description === undefined ? null : (
              <span className={styles.description}>{card.description}</span>
            )}
            <dl className={styles.facts}>
              {card.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.text}</dd>
                </div>
              ))}
            </dl>
            {card.needs === undefined ? null : (
              <span className={styles.needs}>
                {card.needs.logo === undefined ? (
                  <span className={styles.needsIcon}>
                    <Folder size={13} aria-hidden />
                  </span>
                ) : (
                  <AppLogo app={card.needs.logo} size="xs" />
                )}
                {card.needs.text}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
