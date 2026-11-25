import type { ReactNode } from "react";
import styles from "./ReadyCards.module.css";

export interface ReadyCard {
  id: string;
  name: string;
  description?: string;
  facts: { label: string; text: string }[];
  // What it needs before it can run, such as a project folder or an app.
  needs?: ReactNode;
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
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={styles.card}
            aria-pressed={picked === card.id}
            aria-busy={busy === card.id}
            disabled={disabled === true || busy !== undefined}
            onClick={() => onPick(card.id)}
          >
            <strong className={styles.name}>{card.name}</strong>
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
            {card.needs === undefined ? null : <span className={styles.needs}>{card.needs}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
