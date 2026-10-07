import type { AgentRecord, SessionRecord, TaskRecord } from "@office-town/contract";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { useFollow } from "../task/follow.ts";
import styles from "./Chat.module.css";
import { ChatEntry } from "./ChatEntry.tsx";
import { Composer } from "./Composer.tsx";
import { chatOf } from "./chat-items.ts";

interface Goal {
  taskId: string;
  // This agent's sessions in it, oldest first.
  sessions: SessionRecord[];
}

// The agent's sessions across its goals: pages read from the core, newest first, joined by any
// the app learns of live, such as one a message just resumed.
function useConversation(agentId: string) {
  const live = useApp((state) => state.sessions);
  const [loaded, setLoaded] = useState<SessionRecord[]>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const read = async (before?: string) => {
    setLoading(true);
    try {
      const page = await api.listAgentSessions(agentId, before);
      setLoaded((known) => [...known, ...page.sessions]);
      setNext(page.next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel is keyed by agent
  useEffect(() => {
    void read();
  }, []);

  const goals = useMemo(() => {
    const byId = new Map(loaded.map((session) => [session.id, live[session.id] ?? session]));
    const oldestLoaded = loaded.at(-1)?.createdAt ?? "";
    for (const session of Object.values(live)) {
      // Older ones wait for their page, so a goal never shows only part of its sessions.
      if (session.agentId === agentId && session.createdAt >= oldestLoaded) {
        byId.set(session.id, session);
      }
    }
    const sessions = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const grouped = Map.groupBy(sessions, (session) => session.taskId);
    return [...grouped].map(([taskId, list]): Goal => ({ taskId, sessions: list }));
  }, [loaded, live, agentId]);

  useEffect(() => {
    for (const goal of goals) for (const session of goal.sessions) loadTrace(session.id);
  }, [goals]);

  return { goals, more: next !== undefined, loading, error, loadEarlier: () => read(next) };
}

// The tasks of goals the app does not hold, such as old ones, read once for their titles.
function useTasks(taskIds: readonly string[]): Record<string, TaskRecord> {
  const held = useApp((state) => state.tasks);
  const [read, setRead] = useState<Record<string, TaskRecord>>({});
  const missing = taskIds.filter((id) => held[id] === undefined && read[id] === undefined);
  const key = missing.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `missing`
  useEffect(() => {
    for (const id of missing) {
      api
        .getTask(id)
        .then(({ task }) => setRead((known) => ({ ...known, [id]: task })))
        .catch((failure: unknown) => console.error(`Could not read task ${id}.`, failure));
    }
  }, [key]);
  return useMemo(() => {
    const tasks = { ...read };
    for (const [id, entry] of Object.entries(held)) tasks[id] = entry.task;
    return tasks;
  }, [held, read]);
}

function dayAndTime(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (day.toDateString() === today.toDateString()) return `today ${clockTime(iso)}`;
  if (day.toDateString() === yesterday.toDateString()) return `yesterday ${clockTime(iso)}`;
  return day.toLocaleDateString([], { day: "numeric", month: "short" });
}

function GoalChat({
  goal,
  task,
  speaker,
  noted,
}: {
  goal: Goal;
  task: TaskRecord | undefined;
  speaker: AgentRecord;
  noted: ReadonlySet<string>;
}) {
  const traces = useApp((state) => state.traces);
  const agents = useApp((state) => state.agents);
  const chiefName = useApp((state) =>
    state.chiefId === undefined ? "the chief" : (state.agents[state.chiefId]?.name ?? "the chief"),
  );
  const { items, waiting } = useMemo(() => {
    const loaded = goal.sessions.flatMap((session) => traces[session.id] ?? []);
    const ids = new Map(Object.values(agents).map((agent) => [agent.name, agent.id]));
    return {
      items: chatOf(loaded, (name) => ids.get(name)),
      waiting: loaded.length < goal.sessions.length,
    };
  }, [agents, traces, goal.sessions]);
  const start = goal.sessions[0]?.createdAt ?? "";
  return (
    <section aria-label={task === undefined ? "A goal" : taskTitle(task.prompt)}>
      <div className={styles.divider}>
        <span>
          {task === undefined ? "A goal" : taskTitle(task.prompt)}
          {task?.parentTaskId === undefined ? "" : ` · from ${chiefName}`}
          {` · ${dayAndTime(start)}`}
        </span>
      </div>
      {waiting ? <p className={styles.quiet}>Loading…</p> : null}
      {items.map((item) => (
        <ChatEntry key={item.id} item={item} speaker={speaker} noted={noted} goalId={goal.taskId} />
      ))}
    </section>
  );
}

// One conversation with an agent across all its goals, a divider at each goal (D-49).
export function ChatTab({ agentId }: { agentId: string }) {
  const agent = useApp((state) => state.agents[agentId]);
  const department = useApp((state) =>
    agent?.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const { goals, more, loading, error, loadEarlier } = useConversation(agentId);
  const tasks = useTasks(goals.map((goal) => goal.taskId));
  const traces = useApp((state) => state.traces);
  const [noted, setNoted] = useState<ReadonlySet<string>>(new Set());
  const last = goals.at(-1)?.sessions.at(-1);
  const lastTrace = last === undefined ? undefined : traces[last.id];
  const follow = useFollow(`${goals.length}:${lastTrace?.position}`);
  if (agent === undefined) return null;
  const role =
    department === undefined
      ? agent.role
      : `${agent.id === department.leadAgentId ? "lead" : (agent.role?.toLowerCase() ?? "worker")} · ${department.name}`;

  return (
    <>
      <div className={styles.who}>
        <Avatar name={agent.name} colour={agent.colour} size={22} />
        <strong>{agent.name}</strong>
        {role === undefined ? null : <span className={styles.quiet}>{role}</span>}
      </div>
      <div className={styles.scroll} ref={follow.ref} onScroll={follow.onScroll}>
        {more ? (
          <div className={styles.earlier}>
            <Button variant="ghost" disabled={loading} onClick={() => void loadEarlier()}>
              Show earlier goals
            </Button>
          </div>
        ) : null}
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!loading && goals.length === 0 ? (
          <p className={styles.quiet}>
            No conversation yet. It starts with this agent's first goal.
          </p>
        ) : null}
        {goals.map((goal) => (
          <GoalChat
            key={goal.taskId}
            goal={goal}
            task={tasks[goal.taskId]}
            speaker={agent}
            noted={noted}
          />
        ))}
      </div>
      <Composer agent={agent} onNoted={(text) => setNoted(new Set([...noted, text]))} />
    </>
  );
}
