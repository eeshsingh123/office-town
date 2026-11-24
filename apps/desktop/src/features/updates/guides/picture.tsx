import styles from "../Updates.module.css";

interface ScreenProps {
  title: string;
  // A line of text on the screen, such as the link to copy.
  line: string;
  // The one control to press, highlighted.
  press: string;
  // The control sits under the line rather than beside it.
  below?: boolean;
}

// A simplified screen with the one thing to press, drawn in the app's own colours so it follows
// the theme and never goes stale with a vendor's redesign.
export function Screen({ title, line, press, below = false }: ScreenProps) {
  const pressWidth = press.length * 6.4 + 20;
  const pressX = below ? 20 : 260 - pressWidth;
  const pressY = below ? 74 : 44;
  return (
    <svg className={styles.picture} viewBox="0 0 280 104" aria-hidden>
      <rect x="0.5" y="0.5" width="279" height="103" rx="10" className={styles.drawFrame} />
      <rect x="0.5" y="0.5" width="279" height="26" rx="10" className={styles.drawBar} />
      <circle cx="14" cy="13.5" r="3" className={styles.drawDot} />
      <circle cx="24" cy="13.5" r="3" className={styles.drawDot} />
      <text x="38" y="17.5" className={styles.drawTitle}>
        {title}
      </text>
      <rect
        x="20"
        y="44"
        width={below ? 240 : pressX - 30}
        height="20"
        rx="5"
        className={styles.drawField}
      />
      <text x="28" y="57.5" className={styles.drawLine}>
        {line}
      </text>
      <rect
        x={pressX}
        y={pressY}
        width={pressWidth}
        height="20"
        rx="6"
        className={styles.drawPress}
      />
      <text x={pressX + pressWidth / 2} y={pressY + 13.5} className={styles.drawPressText}>
        {press}
      </text>
    </svg>
  );
}
