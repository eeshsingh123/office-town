import { Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import styles from "./AiLine.module.css";

interface AiLineProps {
  summary: string;
  // The choices, shown only after "Change", since most people keep the defaults.
  children?: ReactNode;
  lead?: string;
}

export function AiLine({ summary, children, lead = "Uses" }: AiLineProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.line}>
      <span className={styles.icon} aria-hidden>
        <Sparkles size={13} />
      </span>
      <span>
        {lead} <span className={styles.summary}>{summary}</span>
      </span>
      {children === undefined ? null : (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Done" : "Change"}
        </button>
      )}
      {open ? <div className={styles.chips}>{children}</div> : null}
    </div>
  );
}
