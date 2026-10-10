import type { CSSProperties } from "react";
import styles from "./Avatar.module.css";

interface AvatarProps {
  name: string;
  colour: string;
  size?: number;
}

// The one place a face is drawn, so pixel art or themes can replace it later.
export function Avatar({ name, colour, size = 26 }: AvatarProps) {
  return (
    <span
      className={styles.avatar}
      style={
        {
          width: size,
          height: size,
          "--colour": colour,
          fontSize: Math.round(size * 0.4),
        } as CSSProperties
      }
      aria-hidden
    >
      {/\p{L}/u.exec(name)?.[0]?.toUpperCase()}
    </span>
  );
}
