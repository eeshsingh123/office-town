import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerFilled";
  // An icon-only button; it must then carry an `aria-label`.
  icon?: boolean;
  // While its work runs: the label stays, a spinner shows and the button is off (a1-25).
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  icon = false,
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === "secondary" ? "" : styles[variant],
    icon && styles.icon,
  ];
  return (
    <button
      type="button"
      {...props}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={[...classes, className].filter(Boolean).join(" ")}
    >
      {busy ? <LoaderCircle size={14} className="spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
