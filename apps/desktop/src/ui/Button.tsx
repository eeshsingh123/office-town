import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  // An icon-only button; it must then carry an `aria-label`.
  icon?: boolean;
}

export function Button({ variant = "secondary", icon = false, className, ...props }: ButtonProps) {
  const classes = [
    styles.button,
    variant === "secondary" ? "" : styles[variant],
    icon && styles.icon,
  ];
  return (
    <button
      type="button"
      {...props}
      className={[...classes, className].filter(Boolean).join(" ")}
    />
  );
}
