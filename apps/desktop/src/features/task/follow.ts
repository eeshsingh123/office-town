import { useLayoutEffect, useRef } from "react";

// How close to the end, in pixels, still counts as reading the latest.
const FOLLOW_SLACK = 80;

// Keeps the latest work in view while the reader is at the end, and stays put once they scroll up.
export function useFollow(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again whenever the content grows
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  }, [dependency]);
  const onScroll = () => {
    const element = ref.current;
    if (element === null) return;
    following.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK;
  };
  return { ref, onScroll };
}
