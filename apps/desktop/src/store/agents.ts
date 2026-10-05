import {
  type AgentRecord,
  type Autonomy,
  lowerAutonomy,
  type SessionRecord,
  type TaskRecord,
} from "@office-town/contract";
import { useMemo } from "react";
import { type AgentState, agentState } from "../trace/progress.ts";
import type { Trace } from "../trace/trace.ts";
import { type AppState, useApp } from "./app-store.ts";

// An agent's work on one task: its stored record, and its sessions there. Resuming continues the
// same agent in a new session of the task.
export interface Agent {
  id: string;
  record: AgentRecord;
  name: string;
  colour: string;
  taskId: string;
  task: TaskRecord;
  // Oldest first.
  sessions: SessionRecord[];
  latest: SessionRecord;
}

type Known = Pick<AppState, "agents" | "tasks" | "sessions">;

export function workOf(known: Known, agentId: string, taskId: string): Agent | undefined {
  const record = known.agents[agentId];
  const entry = known.tasks[taskId];
  if (record === undefined || entry === undefined) return undefined;
  const sessions = entry.sessionIds.flatMap((id) => {
    const session = known.sessions[id];
    return session?.agentId === agentId ? [session] : [];
  });
  const latest = sessions.at(-1);
  if (latest === undefined) return undefined;
  const { name, colour } = record;
  return { id: agentId, record, name, colour, taskId, task: entry.task, sessions, latest };
}

// The task an agent worked on most recently, which the office and the panels show.
export function agentOf(known: Known, agentId: string): Agent | undefined {
  let latest: SessionRecord | undefined;
  for (const session of Object.values(known.sessions)) {
    if (session.agentId !== agentId) continue;
    if (latest === undefined || session.createdAt > latest.createdAt) latest = session;
  }
  return latest === undefined ? undefined : workOf(known, agentId, latest.taskId);
}

// The agents that worked on a task, in the order they joined it.
export function agentsInTask(known: Known, taskId: string): Agent[] {
  const ids = new Set(
    (known.tasks[taskId]?.sessionIds ?? []).flatMap((id) => known.sessions[id]?.agentId ?? []),
  );
  return [...ids].flatMap((agentId) => workOf(known, agentId, taskId) ?? []);
}

export function stateOf(agent: Agent, traces: Record<string, Trace>, waiting: boolean): AgentState {
  return agentState(agent.latest, traces[agent.latest.id], waiting);
}

// A task's state with all its agents: one asking makes it wait for the user, and one at work keeps
// it at work, such as workers busy while their lead was stopped for being idle.
export function taskStateOf(
  agents: readonly Agent[],
  traces: Record<string, Trace>,
  waiting: Set<string>,
): AgentState | undefined {
  const states = agents.map((agent) => stateOf(agent, traces, waiting.has(agent.latest.id)));
  if (states.includes("waiting")) return "waiting";
  return states.find((state) => state === "working" || state === "starting") ?? states[0];
}

// Every agent with work, by its latest task, newest first.
export function useAgents(): Agent[] {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(() => {
    const latest = new Map<string, SessionRecord>();
    for (const session of Object.values(sessions)) {
      const known = latest.get(session.agentId);
      if (known === undefined || session.createdAt > known.createdAt) {
        latest.set(session.agentId, session);
      }
    }
    return [...latest]
      .flatMap(
        ([agentId, session]) => workOf({ agents, tasks, sessions }, agentId, session.taskId) ?? [],
      )
      .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
  }, [agents, tasks, sessions]);
}

export function useAgent(agentId: string): Agent | undefined {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(
    () => agentOf({ agents, tasks, sessions }, agentId),
    [agents, tasks, sessions, agentId],
  );
}

// The agent asking, for a request shown away from its trace.
export function useSessionAgent(sessionId: string): Agent | undefined {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(() => {
    const session = sessions[sessionId];
    if (session === undefined) return undefined;
    return workOf({ agents, tasks, sessions }, session.agentId, session.taskId);
  }, [agents, tasks, sessions, sessionId]);
}

// The level an agent works at: its department's, or its own, lowered by its settings.
export function useLevel(agent: AgentRecord | undefined): Autonomy {
  const department = useApp((state) =>
    agent?.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const level = department?.autonomy ?? agent?.autonomy ?? "supervised";
  return lowerAutonomy(level, agent?.settings.autonomy);
}

// The sessions with a request waiting, so each agent's state can be read in one lookup.
export function useWaitingSessions(): Set<string> {
  const waiting = useApp((state) => state.waiting);
  return useMemo(
    () => new Set(Object.values(waiting).map(({ event }) => event.sessionId)),
    [waiting],
  );
}

export interface TaskWithAgents {
  task: TaskRecord;
  // The first is the one who started it: the solo agent, or the lead.
  agents: Agent[];
}

// Every task the app holds, with its agents, newest first.
export function useTasksWithAgents(): TaskWithAgents[] {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(
    () =>
      Object.values(tasks)
        .map(({ task }) => ({ task, agents: agentsInTask({ agents, tasks, sessions }, task.id) }))
        .filter((entry) => entry.agents.length > 0)
        .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt)),
    [agents, tasks, sessions],
  );
}
