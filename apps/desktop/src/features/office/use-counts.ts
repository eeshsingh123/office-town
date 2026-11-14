import { useMemo } from "react";
import { stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { isBusy } from "../../trace/progress.ts";
import { waitingOrder } from "./next-waiting.ts";

// The office top bar's agents at work and who needs you, in the order Next visits them.
export function useCounts() {
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const waitingSessions = useWaitingSessions();
  return useMemo(() => {
    const working = agents.filter((agent) => {
      const state = stateOf(agent, traces, waitingSessions.has(agent.latest.id));
      return isBusy(state);
    }).length;
    return { working, order: waitingOrder(waiting, sessions) };
  }, [agents, traces, waitingSessions, waiting, sessions]);
}
