import styles from "./Count.module.css";

// The one number pill beside a label: tabs, section titles and grouped roles.
export function Count({
  value,
  tone = "plain",
}: {
  // Blank until it is known, rather than a wrong number.
  value: number | string | undefined;
  // Accent for a count that belongs to what is picked; urgent for what needs the user.
  tone?: "plain" | "accent" | "urgent";
}) {
  if (value === undefined) return null;
  return <span className={`${styles.count} ${styles[tone]}`}>{value}</span>;
}
