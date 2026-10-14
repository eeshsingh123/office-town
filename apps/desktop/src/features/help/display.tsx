import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { requestLabel } from "../needs-you/request-label.ts";

// Puts the Display settings on the page root, where the tokens and the zoom read them.
export function useDisplay(): void {
  const display = useApp((state) => state.display);
  useEffect(() => {
    const root = document.documentElement;
    root.style.zoom = String((display.textSize ?? 100) / 100);
    root.toggleAttribute("data-more-contrast", display.moreContrast === true);
    root.toggleAttribute("data-less-motion", display.lessMotion === true);
  }, [display]);
}

// Says each new request out loud to a screen reader, unless the user turned it off.
export function RequestAnnouncer() {
  const on = useApp((state) => state.display.announceRequests !== false);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const heard = useRef<Set<string> | undefined>(undefined);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const keys = Object.entries(waiting);
    // The requests already there when the app opened are not news.
    if (heard.current === undefined) {
      heard.current = new Set(keys.map(([key]) => key));
      return;
    }
    const fresh = keys.filter(([key]) => !heard.current?.has(key));
    for (const [key] of keys) heard.current.add(key);
    const [, request] = fresh.at(-1) ?? [];
    if (!on || request === undefined) return;
    const agentId = sessions[request.event.sessionId]?.agentId;
    const name = (agentId === undefined ? undefined : agents[agentId]?.name) ?? "An agent";
    setMessage(`${name} needs you: ${requestLabel(request)}`);
  }, [waiting, sessions, agents, on]);
  return (
    <div className="visually-hidden" aria-live="polite">
      {message}
    </div>
  );
}
