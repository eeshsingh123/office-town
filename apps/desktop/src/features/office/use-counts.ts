import { useMemo } from "react";
import { stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { isBusy } from "../../trace/progress.ts";
import { statusOfTask } from "../tasks/task-list.ts";
import { waitingOrder } from "./next-waiting.ts";

// The office at a glance, shared by the top bar and Home.
export function useCounts() {
  const entries = useApp((state) => state.tasks);
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const pieces = useApp((state) => state.pieces);
  const records = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const chiefId = useApp((state) => state.chiefId);
  const waitingSessions = useWaitingSessions();
  return useMemo(() => {
    const tasks = Object.values(entries).map((entry) => entry.task);
    const working = agents.filter((agent) => {
      const state = stateOf(agent, traces, waitingSessions.has(agent.latest.id));
      return isBusy(state);
    }).length;
    const queued =
      tasks.filter((task) => task.state === "queued").length +
      Object.values(pieces).filter((piece) => piece.status === "queued").length;
    // The same count as the Board's To review column.
    const known = {
      tasks: entries,
      sessions,
      agents: records,
      departments,
      pieces,
      waiting,
      traces,
      chiefId,
    };
    const toReview = tasks.filter((task) => statusOfTask(known, task.id) === "review").length;
    return { working, queued, toReview, order: waitingOrder(waiting, sessions) };
  }, [
    agents,
    traces,
    waitingSessions,
    waiting,
    sessions,
    pieces,
    entries,
    records,
    departments,
    chiefId,
  ]);
}
