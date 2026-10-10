import type { TaskState } from "@office-town/contract";
import { Check, CircleUser, Network, Plus, Users } from "lucide-react";
import type { ReactNode } from "react";
import {
  type Agent,
  stateOf,
  taskStateOf,
  useAgents,
  useTasksWithAgents,
  useWaitingSessions,
} from "../../store/agents.ts";
import { focusAgent, navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { requestLabel } from "../needs-you/request-label.ts";
import { openChiefSettings, selectAgent, selectRoom, showMode } from "../office/office-state.ts";
import { useCounts } from "../office/use-counts.ts";
import styles from "./Home.module.css";
import { QuickTask } from "./QuickTask.tsx";

const SHOWN_REQUESTS = 3;
const SHOWN_TASKS = 6;

const GOAL_STATE: Record<TaskState, string> = {
  queued: "Queued",
  working: "Working",
  waiting: "Needs you",
  idle: "Idle",
  ended: "Done",
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function openBoard() {
  showMode("board");
  navigate({ name: "office" });
}

function Tiles() {
  const { working, queued, toReview, order } = useCounts();
  const tiles = [
    { label: "working", count: working, open: () => navigate({ name: "office" }) },
    { label: "need you", count: order.length, open: () => navigate({ name: "needs-you" }) },
    { label: "queued", count: queued, open: openBoard },
    { label: "to review", count: toReview, open: openBoard },
  ];
  return (
    <div className={styles.tiles}>
      {tiles.map((tile) => (
        <button
          key={tile.label}
          type="button"
          className={`${styles.tile} ${tile.label === "need you" && tile.count > 0 ? styles.tileWarn : ""}`}
          onClick={tile.open}
        >
          <span className={styles.tileCount}>{tile.count}</span>
          {tile.label}
        </button>
      ))}
    </div>
  );
}

// The longest waiting first, each one click from its card.
function Waiting() {
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const requests = Object.values(waiting).toSorted((a, b) => a.position - b.position);
  if (requests.length === 0) return null;
  return (
    <section className={styles.waiting} aria-label="Needs you">
      <h2 className={styles.waitingTitle}>
        {requests.length === 1 ? "1 request needs you" : `${requests.length} requests need you`}
      </h2>
      <ul className={styles.list}>
        {requests.slice(0, SHOWN_REQUESTS).map((request) => {
          const agentId = sessions[request.event.sessionId]?.agentId;
          const agent = agentId === undefined ? undefined : agents[agentId];
          return (
            <li key={`${request.event.sessionId}/${request.position}`}>
              <button
                type="button"
                className={styles.row}
                onClick={() => {
                  if (agentId === undefined) return navigate({ name: "needs-you" });
                  selectAgent(agentId);
                  focusAgent(agentId);
                }}
              >
                <span className={styles.waitDot} aria-hidden />
                <span className={styles.rowText}>
                  <strong>{agent?.name ?? "An agent"}</strong> · {requestLabel(request)}
                </span>
                <span className={styles.rowAction}>Open</span>
              </button>
            </li>
          );
        })}
      </ul>
      {requests.length > SHOWN_REQUESTS ? (
        <Button variant="ghost" onClick={() => navigate({ name: "needs-you" })}>
          See all {requests.length}
        </Button>
      ) : null}
    </section>
  );
}

function TeamRow(props: {
  icon: ReactNode;
  name: string;
  line: string;
  state?: string | undefined;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" className={styles.row} onClick={props.onOpen}>
        {props.icon}
        <span className={styles.rowText}>
          <span className={styles.rowName}>{props.name}</span>
          <span className={styles.rowLine}>{props.line}</span>
        </span>
        {props.state === undefined ? null : <span className={styles.chip}>{props.state}</span>}
      </button>
    </li>
  );
}

// What an agent at work does now, in one line.
function nowLine(agent: Agent, waiting: boolean, traces: Record<string, Trace>) {
  if (waiting) return "Needs you";
  const trace = traces[agent.latest.id];
  const progress = trace === undefined ? undefined : progressOf(trace);
  if (progress?.step !== undefined) {
    return `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
  }
  return progress?.current?.title ?? taskTitle(agent.task.prompt);
}

function Team() {
  const chiefId = useApp((state) => state.chiefId);
  const records = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const tasks = useApp((state) => state.tasks);
  const traces = useApp((state) => state.traces);
  const waitingSessions = useWaitingSessions();
  const agents = useAgents();

  const activeGoal = (match: (lead?: string, department?: string) => boolean) =>
    Object.values(tasks)
      .map(({ task }) => task)
      .filter(
        (task) =>
          task.state !== "ended" &&
          task.parentTaskId === undefined &&
          match(task.leadAgentId, task.departmentId),
      )
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const chiefGoal = chiefId === undefined ? undefined : activeGoal((lead) => lead === chiefId);
  const list = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const solo = agents.filter(
    (agent) =>
      agent.id !== chiefId &&
      agent.record.departmentId === undefined &&
      agent.record.guest !== true &&
      isOpen(agent.latest),
  );

  return (
    <section className={styles.card} aria-labelledby="team-title">
      <h2 id="team-title" className={styles.cardTitle}>
        Your team
      </h2>
      <ul className={styles.list}>
        {chiefId === undefined ? (
          <TeamRow
            icon={<Network size={16} className={styles.rowIcon} aria-hidden />}
            name="Chief"
            line="Not set up. The chief splits big goals across departments."
            state="Set up"
            onOpen={() => openChiefSettings()}
          />
        ) : (
          <TeamRow
            icon={<Network size={16} className={styles.rowIcon} aria-hidden />}
            name={records[chiefId]?.name ?? "Chief"}
            line={chiefGoal === undefined ? "Ready for a big goal" : taskTitle(chiefGoal.prompt)}
            state={chiefGoal === undefined ? undefined : GOAL_STATE[chiefGoal.state]}
            onOpen={() => selectAgent(chiefId)}
          />
        )}
        {list.map((department) => {
          const goal = activeGoal((_, id) => id === department.id);
          const members = Object.values(records).filter(
            (agent) => agent.departmentId === department.id,
          ).length;
          return (
            <TeamRow
              key={department.id}
              icon={<Users size={16} className={styles.rowIcon} aria-hidden />}
              name={department.name}
              line={
                goal === undefined
                  ? `${members} ${members === 1 ? "member" : "members"} · no goal in progress`
                  : taskTitle(goal.prompt)
              }
              state={goal === undefined ? undefined : GOAL_STATE[goal.state]}
              onOpen={() => selectRoom(department.id)}
            />
          );
        })}
        {solo.map((agent) => {
          const waiting = waitingSessions.has(agent.latest.id);
          return (
            <TeamRow
              key={agent.id}
              icon={<Avatar name={agent.name} colour={agent.colour} size={20} />}
              name={agent.name}
              line={nowLine(agent, waiting, traces)}
              state={STATE_LABELS[stateOf(agent, traces, waiting)]}
              onOpen={() => selectAgent(agent.id)}
            />
          );
        })}
      </ul>
      <div className={styles.create}>
        <Button onClick={() => navigate({ name: "new-department" })}>
          <Plus size={14} aria-hidden />
          Department
        </Button>
        <Button onClick={() => navigate({ name: "profiles" })}>
          <CircleUser size={14} aria-hidden />
          Agent profiles
        </Button>
      </div>
    </section>
  );
}

function Recent() {
  const tasks = useTasksWithAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions();
  const shown = tasks.filter((entry) => entry.task.parentTaskId === undefined);
  return (
    <section className={styles.card} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.cardTitle}>
        Recent tasks
      </h2>
      <ul className={styles.list}>
        {shown.slice(0, SHOWN_TASKS).map((entry) => {
          const state = taskStateOf(entry.agents, traces, waiting);
          return (
            <li key={entry.task.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => navigate({ name: "task", taskId: entry.task.id })}
              >
                {state === undefined ? null : <StatusIcon state={state} />}
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{taskTitle(entry.task.prompt)}</span>
                  <span className={styles.rowLine}>
                    {entry.agents[0]?.name} · {clockTime(entry.task.createdAt)}
                    {state === undefined ? "" : ` · ${STATE_LABELS[state]}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length > SHOWN_TASKS ? (
        <Button variant="ghost" onClick={() => navigate({ name: "tasks" })}>
          All tasks
        </Button>
      ) : null}
    </section>
  );
}

function Step(props: { number: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={`${styles.stepMark} ${props.done ? styles.stepDone : ""}`}>
        {props.done ? <Check size={12} aria-label="Done" /> : props.number}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowName}>{props.title}</span>
        <span className={styles.rowLine}>{props.children}</span>
      </span>
    </li>
  );
}

// Shown until the first task, so a new user always sees the next thing to do.
function GetStarted() {
  const harnesses = useApp((state) => state.harnesses);
  const hasTeam = useApp(
    (state) => state.chiefId !== undefined || Object.keys(state.departments).length > 0,
  );
  return (
    <section className={styles.card} aria-labelledby="start-title">
      <h2 id="start-title" className={styles.cardTitle}>
        Get started
      </h2>
      <ol className={styles.list}>
        <Step number={1} done={false} title="Log in to your coding CLIs">
          Agents run on your own {harnesses.map((one) => one.name).join(" and ") || "CLI"} logins.
          Log in once in each CLI; nothing is set up here.
        </Step>
        <Step number={2} done={hasTeam} title="Build your team (optional)">
          Set up the chief for big goals, or add a department with a lead and workers on any
          harness.
        </Step>
        <Step number={3} done={false} title="Give your first task">
          Type it above. A solo agent is the quickest start; it asks before risky actions.
        </Step>
      </ol>
    </section>
  );
}

// The screen the app opens on: what is happening, what needs you, and a box to start more.
export function HomeView() {
  const { working, order } = useCounts();
  const anyTask = useApp((state) => Object.keys(state.tasks).length > 0);
  const summary =
    working === 0 && order.length === 0
      ? "Your office is quiet."
      : [
          working > 0 ? `${working} ${working === 1 ? "agent is" : "agents are"} working` : "",
          order.length > 0 ? `${order.length} waiting for you` : "",
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <section className={styles.page} aria-labelledby="home-title">
      <div className={styles.column}>
        <h1 id="home-title" className={styles.title}>
          {greeting()}
        </h1>
        <p className={styles.summary}>{summary}</p>
        <QuickTask />
        <Waiting />
        <Tiles />
        <div className={styles.columns}>
          <Team />
          {anyTask ? <Recent /> : <GetStarted />}
        </div>
      </div>
    </section>
  );
}
