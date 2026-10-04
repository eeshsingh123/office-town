import type { SessionRecord, TaskRecord } from "@office-town/contract";
import { useMemo } from "react";
import { type AgentState, agentState } from "../trace/progress.ts";
import type { Trace } from "../trace/trace.ts";
import { useApp } from "./app-store.ts";
import type { Records } from "./records.ts";

// One agent works on one task in M3; resuming it continues the same agent in a new session.
export interface Agent {
  taskId: string;
  task: TaskRecord;
  sessions: SessionRecord[];
  latest: SessionRecord;
  name: string;
  colour: string;
}

const NAMES = [
  "Ava Ben Cleo Dev Eli Fay Gus Hana Ivo Juno Kai Lea Milo Nia Otis Pia Quinn Rae Sami Tess",
  "Uma Vic Wren Yara Zed Ada Bo Cyd Dara Ezra Finn Gia Hugo Iris Jude Kit Lou Mae Ned Opal",
  "Pax Remy Sol Teo Una Vera Wes Xan Yuri Zoe Arlo Bea Cal Dot Esme Flo Gil Hal Ines Jem",
  "Kaya Lars Mina Noor",
]
  .join(" ")
  .split(" ");
// Each keeps white text readable on top of it, in both themes.
const COLOURS = "#B5602B #2F7565 #6553AE #3A6EA5 #A2456E #5E7A2F #8A5A2B #4F5D75".split(" ");

// FNV-1a: the same session always gets the same name and colour, with nothing stored.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

export function agentOf(
  records: Pick<Records, "tasks" | "sessions">,
  taskId: string,
): Agent | undefined {
  const entry = records.tasks[taskId];
  const sessions = (entry?.sessionIds ?? []).flatMap((id) => records.sessions[id] ?? []);
  const first = sessions[0];
  const latest = sessions.at(-1);
  if (entry === undefined || first === undefined || latest === undefined) return undefined;
  const value = hash(first.id);
  // A handle like "@kai-0427". Name, colour and number use separate bits of the hash, so two
  // agents share a handle only about once in 640,000 pairs; stored, unique names come in M4.
  const name = (NAMES[value % NAMES.length] ?? "agent").toLowerCase();
  const number = String((value >>> 11) % 10_000).padStart(4, "0");
  return {
    taskId,
    task: entry.task,
    sessions,
    latest,
    name: `@${name}-${number}`,
    colour: COLOURS[(value >>> 8) % COLOURS.length] ?? "#4F5D75",
  };
}

export function stateOf(agent: Agent, traces: Record<string, Trace>, waiting: boolean): AgentState {
  return agentState(agent.latest, traces[agent.latest.id], waiting);
}

// Newest first.
export function useAgents(): Agent[] {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(() => {
    return Object.keys(tasks)
      .flatMap((taskId) => agentOf({ tasks, sessions }, taskId) ?? [])
      .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt));
  }, [tasks, sessions]);
}

// The sessions with a request waiting, so each agent's state can be read in one lookup.
export function useWaitingSessions(): Set<string> {
  const waiting = useApp((state) => state.waiting);
  return useMemo(
    () => new Set(Object.values(waiting).map(({ event }) => event.sessionId)),
    [waiting],
  );
}
