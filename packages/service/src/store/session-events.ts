import type { SessionEvent } from "@office-town/contract";
import type { Store } from "./store.ts";

const PAGE = 1_000;

export function eventsOf(store: Store, sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.readEvents({ after, limit: PAGE, sessionId });
    events.push(...page.map((stored) => stored.event));
    if (page.length < PAGE) return events;
    after = page.at(-1)?.position ?? after;
  }
}

export const userMessages = (events: SessionEvent[]) =>
  events.flatMap((event) =>
    event.type === "message" && event.payload.role === "user" ? [event.payload] : [],
  );
