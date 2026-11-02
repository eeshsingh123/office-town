import { useLayoutEffect, useState } from "react";

// How close to the end, in pixels, still counts as reading the latest.
const FOLLOW_SLACK = 80;

// Where the reader left each chat; a chat left at its end is not here, and follows new content.
const places = new Map<string, number>();

// One scroller can show many chats, so each keeps its own place under `chat`.
export function useFollow(chat: string, content: unknown) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const place = places.get(chat);
    if (element !== null && place !== undefined) element.scrollTop = place;
  }, [element, chat]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again whenever the content grows
  useLayoutEffect(() => {
    if (element !== null && !places.has(chat)) element.scrollTop = element.scrollHeight;
  }, [element, chat, content]);
  const onScroll = () => {
    if (element === null) return;
    const left = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (left < FOLLOW_SLACK) places.delete(chat);
    else places.set(chat, element.scrollTop);
  };
  return { ref: setElement, onScroll };
}
