import { useEffect, useLayoutEffect, useRef } from "react";
import { focusAgent } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { RequestContext } from "../requests/RequestContext.tsx";
import type { Point } from "./floor-plan.ts";
import styles from "./Office.module.css";

const WIDTH = 340;
const OFFSET = { x: 36, y: 64 };

interface FocusCardProps {
  request: WaitingRequest;
  at: Point;
  floorWidth: number;
  // Takes the keyboard back when the card closes while it held it.
  onClosed: () => void;
}

// Opened beside the agent the floor panned to. Esc closes it unanswered.
export function FocusCard({ request, at, floorWidth, onClosed }: FocusCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const left = at.x + OFFSET.x + WIDTH > floorWidth;
  const sessionId = request.event.sessionId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: takes the keyboard for each request
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [request.event.id]);

  // A layout cleanup runs while the card is still in the page, so it can tell where focus was.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, as the card closes
  useLayoutEffect(() => {
    const element = card.current;
    return () => {
      if (element?.contains(document.activeElement)) onClosed();
    };
  }, []);

  return (
    <div
      ref={card}
      className={`${styles.focusCard} ${left ? styles.focusCardLeft : ""}`}
      style={{
        left: left ? at.x - OFFSET.x - WIDTH : at.x + OFFSET.x,
        top: at.y - OFFSET.y,
        width: WIDTH,
      }}
      role="dialog"
      aria-label="Request"
      data-focus-card
      tabIndex={-1}
      // The card's keys and clicks stay off the floor, so typing an answer never walks.
      onKeyDown={(event) => {
        event.stopPropagation();
        // A menu or dialog opened from the card takes its own Escape.
        if (event.key === "Escape" && !event.defaultPrevented) focusAgent(undefined);
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <RequestCard event={request.event} context={<RequestContext sessionId={sessionId} />} />
    </div>
  );
}
