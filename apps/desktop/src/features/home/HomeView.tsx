import {
  ArrowRight,
  Check,
  ChevronDown,
  Network,
  Plus,
  Sparkles,
  SwatchBook,
  Users,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { type Agent, stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useDraft } from "../../store/drafts.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago, taskName } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { Composer } from "../new-task/Composer.tsx";
import { selectAgent, selectRoom } from "../office/office-state.ts";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { startTutorial } from "../onboarding/tutorial-state.ts";
import { sharedApps, TUTORIALS, type TutorialId } from "../onboarding/tutorials.ts";
import { TaskStatusIcon, TaskStatusOf, TaskStatusTag } from "../tasks/TaskStatusIcon.tsx";
import { showTasksTab } from "../tasks/TasksView.tsx";
import type { Item, RowStatus } from "../tasks/task-list.ts";
import { useNow, useTaskItems } from "../tasks/use-items.ts";
import { WorkerName } from "../tasks/WorkerName.tsx";
import { LimitStops } from "../usage/LimitStops.tsx";
import { PlanUsageCard } from "../usage/PlanUsageCard.tsx";
import { UsagePauses } from "../usage/UsagePauses.tsx";
import { useGreeting } from "./greeting.ts";
import styles from "./Home.module.css";

// Rows per task list on Home, then a link to the rest.
const SHOWN = 3;
const SHOWN_RECENT = 6;
const SHOWN_TEAM = 6;

// One line of counts, each a link; tasks are counted as the Tasks tabs count them.
function StatusLine({ items }: { items: Item[] }) {
  const count = (status: RowStatus) => items.filter((item) => item.status === status).length;
  const needs = count("needs");
  const parts = [
    {
      key: "working",
      count: count("working"),
      text: "working",
      tone: styles.countWorking,
      open: () => showTasksTab("active"),
    },
    {
      key: "needs",
      count: needs,
      text: needs === 1 ? "needs you" : "need you",
      tone: styles.countNeeds,
      open: () => navigate({ name: "needs-you" }),
    },
    {
      key: "review",
      count: count("review"),
      text: "to review",
      tone: styles.countReview,
      open: () => showTasksTab("review"),
    },
  ].filter((part) => part.count > 0);
  if (parts.length === 0) return <>Nothing is working.</>;
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index === 0 ? null : " · "}
          <button type="button" className={`${styles.count} ${part.tone}`} onClick={part.open}>
            {part.count} {part.text}
          </button>
        </Fragment>
      ))}
    </>
  );
}

function TaskItemRow({ item, meta, now }: { item: Item; meta: "line" | "ago"; now: number }) {
  const [first] = item.agents;
  const answerTaskId = item.status === "needs" ? item.answerTaskId : undefined;
  const detail = meta === "ago" ? ago(item.activityAt, now) : item.line?.text;
  return (
    <li className={`${styles.item} ${item.status === "needs" ? styles.itemNeeds : ""}`}>
      <button
        type="button"
        className={styles.itemOpen}
        onClick={() => navigate({ name: "task", taskId: item.id })}
      >
        <TaskStatusIcon status={item.status} />
        <span className={styles.rowText}>
          <span className={styles.rowName}>{item.title}</span>
          <span className={styles.rowLine}>
            {first === undefined ? null : <WorkerName agent={first} />}
            {detail === undefined ? null : `${first === undefined ? "" : " · "}${detail}`}
          </span>
        </span>
      </button>
      {answerTaskId === undefined ? null : (
        <Button
          className={styles.answer}
          onClick={() => navigate({ name: "task", taskId: answerTaskId })}
        >
          Answer
        </Button>
      )}
    </li>
  );
}

function TaskSection(props: {
  id: string;
  title: string;
  items: Item[];
  meta: "line" | "ago";
  now: number;
  all?: { label: string; open: () => void };
}) {
  if (props.items.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby={props.id}>
      <div className={styles.sectionHead}>
        <h2 id={props.id} className={styles.sectionTitle}>
          {props.title}
        </h2>
        <span className={styles.sectionCount}>{props.items.length}</span>
        {props.all === undefined || props.items.length <= SHOWN ? null : (
          <button type="button" className={styles.sectionLink} onClick={props.all.open}>
            {props.all.label}
          </button>
        )}
      </div>
      <ul className={styles.panel}>
        {props.items.slice(0, SHOWN).map((item) => (
          <TaskItemRow key={item.id} item={item} meta={props.meta} now={props.now} />
        ))}
      </ul>
    </section>
  );
}

function TeamRow(props: {
  icon: ReactNode;
  name: ReactNode;
  line: string;
  state?: ReactNode;
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
        {props.state}
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
  return progress?.current?.title ?? taskName(agent.task);
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
        {chiefId === undefined ? null : (
          <TeamRow
            icon={<Network size={16} className={styles.rowIcon} aria-hidden />}
            name={records[chiefId]?.name ?? "Chief"}
            line={chiefGoal === undefined ? "No goal in progress" : taskName(chiefGoal)}
            state={chiefGoal === undefined ? undefined : <TaskStatusOf taskId={chiefGoal.id} />}
            onOpen={() => navigate({ name: "chief" })}
          />
        )}
        {list.slice(0, SHOWN_TEAM).map((department) => {
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
                  ? `${members} ${members === 1 ? "member" : "members"} · no task in progress`
                  : taskName(goal)
              }
              state={goal === undefined ? undefined : <TaskStatusOf taskId={goal.id} />}
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
              name={<WorkerName agent={agent} />}
              line={nowLine(agent, waiting, traces)}
              state={
                <span className={styles.chip}>{STATE_LABELS[stateOf(agent, traces, waiting)]}</span>
              }
              onOpen={() => selectAgent(agent.id)}
            />
          );
        })}
      </ul>
      {list.length > SHOWN_TEAM ? (
        <Button variant="ghost" onClick={() => navigate({ name: "team" })}>
          All {list.length} departments
        </Button>
      ) : null}
      <div className={styles.create}>
        <Button onClick={() => navigate({ name: "new-department" })}>
          <Plus size={14} aria-hidden />
          New department
        </Button>
        <Button onClick={() => navigate({ name: "team" })}>
          <Users size={14} aria-hidden />
          Open Team
        </Button>
        <Button onClick={() => navigate({ name: "templates" })}>
          <SwatchBook size={14} aria-hidden />
          Templates
        </Button>
      </div>
    </section>
  );
}

function Recent({ items, now }: { items: Item[]; now: number }) {
  const shown = items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className={styles.card} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.cardTitle}>
        Recent tasks
      </h2>
      <ul className={styles.list}>
        {shown.slice(0, SHOWN_RECENT).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.row}
              onClick={() => navigate({ name: "task", taskId: item.id })}
            >
              <span className={styles.rowText}>
                <span className={styles.rowName}>{item.title}</span>
                <span className={styles.rowLine}>
                  {item.agents[0] === undefined ? null : <WorkerName agent={item.agents[0]} />}
                  {` · ${ago(item.createdAt, now)}`}
                </span>
              </span>
              <TaskStatusTag status={item.status} />
            </button>
          </li>
        ))}
      </ul>
      {shown.length > SHOWN_RECENT ? (
        <Button variant="ghost" onClick={() => navigate({ name: "tasks" })}>
          All tasks
        </Button>
      ) : null}
    </section>
  );
}

function Step(props: {
  number: number;
  done: boolean;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className={styles.step}>
      <span className={`${styles.stepMark} ${props.done ? styles.stepDone : ""}`}>
        {props.done ? <Check size={12} aria-label="Done" /> : props.number}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowName}>{props.title}</span>
        <span className={styles.rowLine}>{props.children}</span>
      </span>
      {props.done ? null : props.action}
    </li>
  );
}

// Until there is a chief or a department: say what you need, or set one up step by step.
function BuildTeam() {
  const [text, setText] = useDraft("build-team", "");
  const draft = () => {
    if (text.trim() === "") return;
    setText("");
    navigate({ name: "new-department", describe: text.trim() });
  };
  return (
    <section className={`${styles.card} ${styles.build}`} aria-labelledby="build-title">
      <div>
        <h2 id="build-title" className={styles.cardTitle}>
          Build your team
        </h2>
        <p className={styles.buildLead}>
          Describe the team you want, or build a department by hand.
        </p>
      </div>
      <div className={styles.buildBox}>
        <label htmlFor="build-text" className="visually-hidden">
          Describe the team you want
        </label>
        <textarea
          id="build-text"
          className={form.input}
          value={text}
          placeholder="For example: I need a team of 3 to build landing pages. A lead on Opus plans the work, a developer on a free model writes the code, and a reviewer checks it."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            draft();
          }}
        />
        <Button variant="primary" disabled={text.trim() === ""} onClick={draft}>
          <Sparkles size={15} aria-hidden />
          Draft my team
        </Button>
      </div>
      <div className={styles.buildChoices}>
        <button
          type="button"
          className={styles.buildChoice}
          onClick={() => navigate({ name: "new-department" })}
        >
          <Users size={18} aria-hidden />
          <strong>New department</strong>
          <span>
            A lead and the people it hands work to, with their own workspaces and one set of rules.
          </span>
          <span className={styles.buildGo}>
            Start <ArrowRight size={13} aria-hidden />
          </span>
        </button>
      </div>
    </section>
  );
}

// Folded to one line until opened, so a returning user sees their work first.
// Each step ticks itself off from what the user really did, and opens its tutorial.
function GettingStarted() {
  const state = useApp();
  const [open, setOpen] = useState(false);
  const hidden = state.onboarding?.checklistHidden === true;
  const done: Record<TutorialId, boolean> = {
    "first-task": Object.values(state.tasks).some(
      ({ task }) => task.state === "idle" || task.state === "ended",
    ),
    department: Object.keys(state.departments).length > 0,
    chief: Object.keys(state.pieces).length > 0,
    library: Object.keys(state.library).length > 0,
    apps: sharedApps(state) > 0,
  };
  const count = TUTORIALS.filter((tutorial) => done[tutorial.id]).length;
  if (hidden || count === TUTORIALS.length) return null;
  return (
    <section className={styles.card} aria-labelledby="start-title">
      <div className={styles.cardHead}>
        <h2 id="start-title" className={styles.foldTitle}>
          <button
            type="button"
            className={styles.fold}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={15} className={open ? undefined : styles.foldClosed} aria-hidden />
            Getting started · {count} of {TUTORIALS.length}
          </button>
        </h2>
        <Button variant="ghost" onClick={() => void saveOnboarding({ checklistHidden: true })}>
          Hide
        </Button>
      </div>
      {open ? (
        <ol className={`${styles.list} ${styles.steps}`}>
          {TUTORIALS.map((tutorial, index) => {
            const blocked = tutorial.blocked?.(state);
            return (
              <Step
                key={tutorial.id}
                number={index + 1}
                done={done[tutorial.id]}
                title={tutorial.title}
                action={
                  <Button
                    disabled={blocked !== undefined}
                    onClick={() => void startTutorial(tutorial.id)}
                  >
                    Start
                  </Button>
                }
              >
                {blocked ?? tutorial.summary}
              </Step>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

// The screen the app opens on: what needs you, what is at work and what to review, then the rest.
export function HomeView() {
  const greeting = useGreeting();
  const now = useNow();
  const items = useTaskItems(now).filter((item) => item.goalId === undefined);
  const hasTeam = useApp(
    (state) => state.chiefId !== undefined || Object.keys(state.departments).length > 0,
  );
  const byActivity = (status: RowStatus) =>
    items
      .filter((item) => item.status === status)
      .toSorted((a, b) => b.activityAt.localeCompare(a.activityAt));
  const working = byActivity("working");
  const review = byActivity("review");
  return (
    <section className={styles.page} aria-labelledby="home-title">
      <div className={styles.column}>
        <header className={styles.header}>
          <h1 id="home-title" className={styles.title}>
            {greeting}
          </h1>
          <p className={styles.summary}>
            <StatusLine items={items} />
          </p>
        </header>
        <Composer home />
        <UsagePauses />
        <LimitStops />
        {hasTeam ? null : <BuildTeam />}
        <TaskSection
          id="needs-title"
          title="Needs you"
          items={byActivity("needs")}
          meta="line"
          now={now}
          all={{ label: "All in Needs you", open: () => navigate({ name: "needs-you" }) }}
        />
        {working.length + review.length === 0 ? null : (
          <div className={styles.columns}>
            <TaskSection
              id="working-title"
              title="Working"
              items={working}
              meta="line"
              now={now}
              all={{ label: "All in Tasks", open: () => showTasksTab("active") }}
            />
            <TaskSection
              id="review-title"
              title="To review"
              items={review}
              meta="ago"
              now={now}
              all={{ label: "All in Tasks", open: () => showTasksTab("review") }}
            />
          </div>
        )}
        <div className={styles.columns}>
          {items.length === 0 ? null : <Recent items={items} now={now} />}
          <Team />
        </div>
        <PlanUsageCard className={styles.card} />
        <GettingStarted />
      </div>
    </section>
  );
}
