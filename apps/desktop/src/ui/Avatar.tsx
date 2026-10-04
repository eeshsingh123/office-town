import styles from "./Avatar.module.css";

interface AvatarProps {
  name: string;
  colour: string;
  size?: number;
}

// The one place an agent's face is drawn, so pixel art or themes can replace it later as a skin.
export function Avatar({ name, colour, size = 26 }: AvatarProps) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: colour, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}
