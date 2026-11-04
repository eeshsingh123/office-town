import type { AgentRecord, SessionRecord, TaskRecord } from "@office-town/contract";
import { ChevronRight } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useEffect, useId, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskName } from "../../ui/format.ts";
import { useFollow } from "../task/follow.ts";
import styles from "./Chat.module.css";
import { ChatEntry } from "./ChatEntry.tsx";
import { Composer } from "./Composer.tsx";
import { chatOf } from "./chat-items.ts";

interface Goal {
  taskId: string;
  // Oldest first.
  sessions: SessionRecord[];
}

// Pages read from the core, newest first, joined by sessions the app learns of live.
function useConversation(agentId: string) {
  const live = useApp(
    useShallow((state) =>
      Object.values(state.sessions).filter((session) => session.agentId === agentId),
    ),
  );
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
    const current = new Map(live.map((session) => [session.id, session]));
    const byId = new Map(loaded.map((session) => [session.id, current.get(session.id) ?? session]));
    const oldestLoaded = loaded.at(-1)?.createdAt ?? "";
    for (const session of live) {
      // Older ones wait for their page, so a goal never shows only part of its sessions.
      if (session.createdAt >= oldestLoaded) byId.set(session.id, session);
    }
    const sessions = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const grouped = Map.groupBy(sessions, (session) => session.taskId);
    // By their latest session, so a follow-up to an older goal shows last, where the view follows.
    const latest = (goal: Goal) => goal.sessions.at(-1)?.createdAt ?? "";
    return [...grouped]
      .map(([taskId, list]): Goal => ({ taskId, sessions: list }))
      .sort((a, b) => latest(a).localeCompare(latest(b)));
  }, [loaded, live]);

  useEffect(() => {
    for (const goal of goals) for (const session of goal.sessions) loadTrace(session.id);
  }, [goals]);

  return { goals, more: next !== undefined, loading, error, loadEarlier: () => read(next) };
}

// Goals the app does not hold, such as old ones, read once for their titles.
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
  if (day.toDateString() === today.toDateString()) return `Today ${clockTime(iso)}`;
  if (day.toDateString() === yesterday.toDateString()) return `Yesterday ${clockTime(iso)}`;
  return day.toLocaleDateString([], { day: "numeric", month: "short" });
}

const MESSAGES = new Set(["user", "agent", "passed"]);

// One header per goal (D-88). An open goal's header stays in view while its chat scrolls.
function GoalChat({
  goal,
  task,
  speaker,
  noted,
  current,
  open,
  onToggle,
}: {
  goal: Goal;
  task: TaskRecord | undefined;
  speaker: AgentRecord;
  noted: ReadonlySet<string>;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const traces = useApp(
    useShallow((state) => goal.sessions.map((session) => state.traces[session.id])),
  );
  const agents = useApp((state) => state.agents);
  const delegations = useApp((state) => state.delegations);
  const ended = task?.state === "ended";
  const chiefName = useApp((state) =>
    state.chiefId === undefined ? "the chief" : (state.agents[state.chiefId]?.name ?? "the chief"),
  );
  const { items, waiting } = useMemo(() => {
    const loaded = traces.filter((trace) => trace !== undefined);
    const ids = new Map(Object.values(agents).map((agent) => [agent.name, agent.id]));
    const records = Object.values(delegations).filter((one) => one.taskId === goal.taskId);
    return {
      items: chatOf(loaded, { idOfName: (name) => ids.get(name), delegations: records, ended }),
      waiting: loaded.length < goal.sessions.length,
    };
  }, [agents, traces, delegations, ended, goal.taskId, goal.sessions.length]);
  const start = goal.sessions[0]?.createdAt ?? "";
  const name = task === undefined ? "A goal" : taskName(task);
  const messages = items.filter((item) => MESSAGES.has(item.kind)).length;
  return (
    <section
      aria-label={name}
      className={`${styles.goal} ${current && open ? styles.current : styles.card} ${open ? styles.opened : ""}`}
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={`${styles.goalHead} ${open ? styles.pinned : ""}`}
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronRight size={14} aria-hidden className={open ? styles.turned : undefined} />
            <span className={styles.goalText}>
              <span className={styles.goalName}>{name}</span>
              <span className={styles.goalMeta}>
                {dayAndTime(start)}
                {task?.parentTaskId === undefined ? "" : ` · from ${chiefName}`}
                {open ? "" : ` · ${messages} ${messages === 1 ? "message" : "messages"}`}
              </span>
            </span>
            {/* The panel's own status already speaks for the latest goal. */}
            {ended && !current ? <span className={styles.done}>Done</span> : null}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tip} side="bottom" sideOffset={6}>
            A new conversation: {speaker.name} started this task without the earlier ones in its
            context.
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      {open && waiting ? <p className={styles.quiet}>Loading…</p> : null}
      {open
        ? items.map((item) => (
            <ChatEntry
              key={item.id}
              item={item}
              speaker={speaker}
              noted={noted}
              goalId={goal.taskId}
            />
          ))
        : null}
    </section>
  );
}

// A header at each goal (D-49); earlier goals fold until the user opens them (D-88).
// `named` shows who the chat goes to, where the panel is about someone else, such as a department.
export function ChatTab({ agentId, named }: { agentId: string; named: boolean }) {
  const agent = useApp((state) => state.agents[agentId]);
  const department = useApp((state) =>
    agent?.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const { goals, more, loading, error, loadEarlier } = useConversation(agentId);
  const tasks = useTasks(goals.map((goal) => goal.taskId));
  const [noted, setNoted] = useState<ReadonlySet<string>>(new Set());
  // Only the user's own folding is kept, so a goal that stops being the latest folds again.
  const [folding, setFolding] = useState<ReadonlyMap<string, boolean>>(new Map());
  const latestGoal = goals.at(-1)?.taskId;
  const last = goals.at(-1)?.sessions.at(-1);
  const lastPosition = useApp((state) =>
    last === undefined ? undefined : state.traces[last.id]?.position,
  );
  // The conversation is read afresh each time the tab opens, so there is no place to return to.
  const follow = useFollow(useId(), `${goals.length}:${lastPosition}`);
  if (agent === undefined) return null;
  const role =
    department === undefined
      ? agent.role
      : `${agent.id === department.leadAgentId ? "lead" : (agent.role?.toLowerCase() ?? "worker")} · ${department.name}`;

  return (
    <>
      {named ? (
        <div className={styles.who}>
          <Avatar name={agent.name} colour={agent.colour} size={22} />
          <strong>{agent.name}</strong>
          {role === undefined ? null : <span className={styles.quiet}>{role}</span>}
        </div>
      ) : null}
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
        {!loading && goals.length === 0 ? <p className={styles.quiet}>No messages yet.</p> : null}
        {goals.map((goal) => {
          const current = goal.taskId === latestGoal;
          const open = folding.get(goal.taskId) ?? current;
          return (
            <GoalChat
              key={goal.taskId}
              goal={goal}
              task={tasks[goal.taskId]}
              speaker={agent}
              noted={noted}
              current={current}
              open={open}
              onToggle={() => setFolding(new Map([...folding, [goal.taskId, !open]]))}
            />
          );
        })}
      </div>
      <Composer
        agent={agent}
        latestGoal={latestGoal}
        nameOf={(taskId) => {
          const task = tasks[taskId];
          return task === undefined ? undefined : taskName(task);
        }}
        onNoted={(text) => setNoted(new Set([...noted, text]))}
      />
    </>
  );
}
