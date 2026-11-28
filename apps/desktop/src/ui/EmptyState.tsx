import { type LucideIcon, SearchX } from "lucide-react";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  // Good news (nothing waiting) in green, a failure in red; everything else is neutral.
  tone?: "neutral" | "good" | "bad";
  // A page's body, or a side pane or section inside a page.
  size?: "page" | "panel";
  // One action, only when nothing else on the page does it (Try again after a failure).
  // Creating and clearing filters already live in the page header and beside the filters.
  children?: ReactNode;
}

// Never closer than this to the page's header and tools.
const MIN_TOP = 40;

function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return undefined;
}

// Pages wrap their empty state differently, so it measures where it sits and pads itself down
// to the middle of the page it scrolls in.
function useCentred(box: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const element = box.current;
    const scroller = element === null ? undefined : scrollerOf(element);
    if (!on || element === null || scroller === undefined) return;
    const place = () => {
      const style = getComputedStyle(element);
      const content =
        element.offsetHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const top =
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const pad = Math.max(MIN_TOP, scroller.clientHeight / 2 - top - content / 2);
      element.style.paddingTop = `${Math.round(pad)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(scroller);
    if (element.parentElement !== null) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [box, on]);
}

// What a list, pane or page shows when it has nothing: an icon, a title, one short hint.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  tone = "neutral",
  size = "page",
  children,
}: EmptyStateProps) {
  const box = useRef<HTMLDivElement>(null);
  useCentred(box, size === "page");
  return (
    <div ref={box} className={`${styles.empty} ${styles[size]} ${styles[tone]}`}>
      <span className={styles.bubble} aria-hidden>
        <Icon size={size === "page" ? 28 : 20} strokeWidth={1.75} />
      </span>
      <p className={styles.title}>{title}</p>
      {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
      {children === undefined ? null : <div className={styles.action}>{children}</div>}
    </div>
  );
}

// Search or filters found nothing; the Clear filters button sits beside the filters.
export function NoMatch({
  title = "Nothing matches these filters",
  hint = "Try other filters, or clear them above.",
  size = "page",
}: {
  title?: string;
  hint?: string;
  size?: "page" | "panel";
}) {
  return <EmptyState icon={SearchX} title={title} hint={hint} size={size} />;
}
