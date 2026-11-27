import type { ReactNode } from "react";
import { Count } from "./Count.tsx";
import styles from "./Facts.module.css";

// A page's summary line: separate facts spaced apart, never numbers and words joined by dots.
export function Facts({ children }: { children: ReactNode }) {
  return <span className={styles.facts}>{children}</span>;
}

// One fact: its number in the app's count pill, then its words, centred on one line.
export function Fact(props: {
  count?: number | undefined;
  // Urgent only for what needs the user, as the tabs show it.
  urgent?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      {props.count === undefined ? null : (
        <Count value={props.count} tone={props.urgent === true ? "urgent" : "plain"} />
      )}
      {props.children}
    </>
  );
  if (props.onClick === undefined) return <span className={styles.fact}>{content}</span>;
  return (
    <button type="button" className={`${styles.fact} ${styles.link}`} onClick={props.onClick}>
      {content}
    </button>
  );
}
