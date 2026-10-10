import { useMemo } from "react";
import { stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { waitingOrder } from "./next-waiting.ts";

// The office at a glance, shared by the top bar and Home.
export function useCounts() {
  const entries = useApp((state) => state.tasks);
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const pieces = useApp((state) => state.pieces);
  const waitingSessions = useWaitingSessions();
  return useMemo(() => {
    const tasks = Object.values(entries).map((entry) => entry.task);
    const working = agents.filter((agent) => {
      const state = stateOf(agent, traces, waitingSessions.has(agent.latest.id));
      return state === "working" || state === "starting";
    }).length;
    const queued =
      tasks.filter((task) => task.state === "queued").length +
      Object.values(pieces).filter((piece) => piece.status === "queued").length;
    const toReview = tasks.filter(
      (task) =>
        task.state === "ended" && task.reviewedAt === undefined && task.parentTaskId === undefined,
    ).length;
    return { working, queued, toReview, order: waitingOrder(waiting, sessions) };
  }, [agents, traces, waitingSessions, waiting, sessions, pieces, entries]);
}
