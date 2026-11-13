import type { ReactNode } from "react";
import styles from "./SamplePrompts.module.css";

interface Sample {
  title: string;
  description: string;
  prompt: string;
  preview: ReactNode;
}

// Prompts people use to compare models, picked for results worth looking at.
const SAMPLES: Sample[] = [
  {
    title: "Balls in a spinning hexagon",
    description: "Physics: gravity, friction and collisions inside a moving wall.",
    prompt:
      "Write a single HTML file with a canvas: 20 numbered balls bounce inside a slowly spinning hexagon. Use gravity, friction and realistic collisions between the balls and with the walls. Add a slider for the spin speed.",
    preview: (
      <>
        <polygon
          points="80,10 116,30 116,70 80,90 44,70 44,30"
          transform="rotate(12 80 50)"
          className={styles.line}
        />
        <circle cx="70" cy="66" r="7" className={styles.accent} />
        <circle cx="88" cy="70" r="6" className={styles.ok} />
        <circle cx="96" cy="52" r="5" className={styles.warm} />
        <circle cx="62" cy="48" r="5" className={styles.bad} />
        <circle cx="80" cy="34" r="4" className={styles.accent} />
      </>
    ),
  },
  {
    title: "Solar system in motion",
    description: "An animated canvas with orbits, a starfield and controls.",
    prompt:
      "Build a single HTML page that animates the solar system on a canvas: the Sun and eight planets on elliptical orbits at their relative speeds, a starfield behind them, each planet's name on hover, and buttons to speed up, slow down and pause.",
    preview: (
      <>
        <ellipse cx="80" cy="50" rx="24" ry="10" className={styles.line} />
        <ellipse cx="80" cy="50" rx="44" ry="20" className={styles.line} />
        <ellipse cx="80" cy="50" rx="66" ry="32" className={styles.line} />
        <circle cx="80" cy="50" r="8" className={styles.warm} />
        <circle cx="104" cy="50" r="3" className={styles.accent} />
        <circle cx="48" cy="38" r="4" className={styles.ok} />
        <circle cx="128" cy="72" r="5" className={styles.bad} />
        <circle cx="22" cy="14" r="1" className={styles.dim} />
        <circle cx="140" cy="18" r="1" className={styles.dim} />
        <circle cx="30" cy="84" r="1" className={styles.dim} />
      </>
    ),
  },
  {
    title: "Landing page for a coffee brand",
    description: "Visual design, typography and a layout that works on a phone.",
    prompt:
      "Design a modern landing page for a small coffee roaster as one HTML file: a hero with a headline and a call to action, three featured blends as cards, a short story section, customer quotes and a footer. Use a warm palette, good typography and smooth hover effects. It must look good on a phone too.",
    preview: (
      <>
        <rect x="20" y="10" width="120" height="80" rx="4" className={styles.page} />
        <rect x="28" y="16" width="20" height="4" rx="2" className={styles.dim} />
        <rect x="112" y="16" width="20" height="4" rx="2" className={styles.dim} />
        <rect x="28" y="28" width="62" height="8" rx="2" className={styles.warm} />
        <rect x="28" y="40" width="44" height="4" rx="2" className={styles.dim} />
        <rect x="28" y="50" width="24" height="7" rx="3" className={styles.accent} />
        <circle cx="116" cy="40" r="14" className={styles.warm} />
        <rect x="28" y="66" width="32" height="18" rx="3" className={styles.card} />
        <rect x="64" y="66" width="32" height="18" rx="3" className={styles.card} />
        <rect x="100" y="66" width="32" height="18" rx="3" className={styles.card} />
      </>
    ),
  },
  {
    title: "Sales dashboard from sample data",
    description: "Stat cards, a line chart, a bar chart and a table, drawn by hand.",
    prompt:
      "Create one HTML file with a sales dashboard: make up a year of monthly sales for four products, then show total revenue, the best month and growth as stat cards, a line chart by month, a bar chart by product and a sortable table. Draw the charts with SVG, no libraries.",
    preview: (
      <>
        <rect x="16" y="10" width="38" height="16" rx="3" className={styles.card} />
        <rect x="60" y="10" width="38" height="16" rx="3" className={styles.card} />
        <rect x="104" y="10" width="40" height="16" rx="3" className={styles.card} />
        <polyline
          points="18,78 34,66 50,70 66,52 82,58 96,40"
          className={`${styles.line} ${styles.accentLine}`}
        />
        <rect x="108" y="58" width="7" height="24" rx="1.5" className={styles.ok} />
        <rect x="119" y="46" width="7" height="36" rx="1.5" className={styles.accent} />
        <rect x="130" y="64" width="7" height="18" rx="1.5" className={styles.warm} />
      </>
    ),
  },
  {
    title: "A small arcade game",
    description: "A game loop, keyboard input, scoring and sound in one file.",
    prompt:
      "Make an original arcade game in one HTML file: the player steers a ship left and right to dodge falling rocks that speed up over time. Show the score, keep the best score, and add a start screen, a game-over screen and simple sound effects made with the Web Audio API.",
    preview: (
      <>
        <polygon points="80,70 72,86 88,86" className={styles.accent} />
        <polygon points="40,20 50,16 56,26 46,32 38,28" className={styles.dim} />
        <polygon points="104,36 116,32 120,44 108,48" className={styles.dim} />
        <polygon points="66,44 74,42 76,50 68,52" className={styles.dim} />
        <polygon points="128,10 136,12 134,20 126,18" className={styles.dim} />
        <rect x="16" y="10" width="22" height="5" rx="2" className={styles.warm} />
      </>
    ),
  },
  {
    title: "A pelican riding a bicycle",
    description: "A popular test of how well a model draws with code.",
    prompt:
      "Draw an SVG of a pelican riding a bicycle as a single file. Make it clean and easy to recognise: the frame, both wheels with spokes, the pedals, and the pelican's long beak and throat pouch.",
    preview: (
      <>
        <circle cx="52" cy="70" r="16" className={styles.line} />
        <circle cx="112" cy="70" r="16" className={styles.line} />
        <polyline points="52,70 74,70 100,50 112,70" className={styles.line} />
        <polyline points="74,70 66,48 100,50" className={styles.line} />
        <ellipse cx="78" cy="36" rx="16" ry="11" className={styles.pale} />
        <circle cx="94" cy="22" r="6" className={styles.pale} />
        <polygon points="98,20 130,26 98,27" className={styles.warm} />
      </>
    ),
  },
];

interface SamplePromptsProps {
  // Fills the box with the prompt.
  onUse: (prompt: string) => void;
}

export function SamplePrompts({ onUse }: SamplePromptsProps) {
  return (
    <section className={styles.samples} aria-labelledby="samples-title">
      <h2 id="samples-title" className={styles.heading}>
        Sample prompts
      </h2>
      <div className={styles.grid}>
        {SAMPLES.map((sample) => (
          <button
            key={sample.title}
            type="button"
            className={styles.sample}
            onClick={() => onUse(sample.prompt)}
          >
            <svg className={styles.preview} viewBox="0 0 160 100" aria-hidden>
              {sample.preview}
            </svg>
            <span className={styles.text}>
              <strong>{sample.title}</strong>
              <span>{sample.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
