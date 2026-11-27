import { GraduationCap, Network, Plus } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { type Agent, stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Count } from "../../ui/Count.tsx";
import { Fact, Facts } from "../../ui/Facts.tsx";
import { ago, taskName } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { AutomationsCard } from "../automations/AutomationsCard.tsx";
import { peopleLine } from "../departments/team-line.ts";
import { useNewPosts } from "../feed/feed.ts";
import { Composer } from "../new-task/Composer.tsx";
import { selectAgent, selectRoom } from "../office/office-state.ts";
import { saveOnboarding } from "../onboarding/onboarding.ts";
import { useNextTutorial } from "../onboarding/TutorialList.tsx";
import { startTutorial } from "../onboarding/tutorial-state.ts";
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
import { StoppedTasksCard } from "./StoppedTasksCard.tsx";

// Rows per task list on Home, then a link to the rest.
const SHOWN = 3;
const SHOWN_RECENT = 6;
const SHOWN_TEAM = 6;

// Names shown before the rest fold into "and N more".
const SHOWN_WORKERS = 2;

interface Worker {
  key: string;
  name: string;
  open: () => void;
  // Several assistants, named as one count.
  many?: true;
}

// Who is working, by name: each department, the chief, then the assistants as one count.
function useWorkers(working: Item[]): Worker[] {
  const departments = useApp((state) => state.departments);
  const chiefId = useApp((state) => state.chiefId);
  const chiefName = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId]?.name,
  );
  const teams = new Set(working.map((item) => item.team));
  const workers: Worker[] = [];
  for (const department of Object.values(departments)) {
    if (!teams.has(department.id)) continue;
    workers.push({
      key: department.id,
      name: department.name,
      open: () => selectRoom(department.id),
    });
  }
  if (teams.has("chief") && chiefId !== undefined) {
    workers.push({ key: "chief", name: chiefName ?? "Chief", open: () => selectAgent(chiefId) });
  }
  const assistants = working.filter((item) => item.team === "solo").length;
  if (assistants > 0) {
    workers.push({
      key: "solo",
      name: assistants === 1 ? "An assistant" : `${assistants} assistants`,
      open: () => showTasksTab("active"),
      ...(assistants === 1 ? {} : { many: true as const }),
    });
  }
  return workers;
}

// "Design and Research are working", each name opening where it works.
function WorkingLine({ workers }: { workers: Worker[] }) {
  const shown = workers.slice(0, SHOWN_WORKERS);
  const more = workers.length - shown.length;
  const links: Worker[] =
    more > 0
      ? [...shown, { key: "more", name: `${more} more`, open: () => showTasksTab("active") }]
      : shown;
  const plural = workers.length > 1 || workers[0]?.many === true;
  return (
    <>
      {links.map((link, index) => (
        <Fragment key={link.key}>
          {index === 0 ? null : index === links.length - 1 ? " and " : ", "}
          <button type="button" className={`${styles.count} ${styles.worker}`} onClick={link.open}>
            {link.name}
          </button>
        </Fragment>
      ))}
      {plural ? " are working" : " is working"}
    </>
  );
}

// Who is working, then counts that each open their list; tasks are counted as the Tasks tabs
// count them. With nothing going on, an invitation to start one.
function StatusLine({ items }: { items: Item[] }) {
  const count = (status: RowStatus) => items.filter((item) => item.status === status).length;
  const workers = useWorkers(items.filter((item) => item.status === "working"));
  const hasTeam = useApp(
    (state) => state.chiefId !== undefined || Object.keys(state.departments).length > 0,
  );
  const needs = count("needs");
  const newPosts = useNewPosts();
  const parts = [
    {
      key: "needs",
      count: needs,
      text: needs === 1 ? "needs you" : "need you",
      open: () => navigate({ name: "needs-you" }),
    },
    {
      key: "review",
      count: count("review"),
      text: "to review",
      open: () => showTasksTab("review"),
    },
    {
      key: "feed",
      count: newPosts,
      text: newPosts === 1 ? "new post since you were here" : "new posts since you were here",
      open: () => navigate({ name: "feed" }),
    },
  ].filter((part) => part.count > 0);
  if (workers.length === 0 && parts.length === 0) {
    return <>{hasTeam ? "Your team is idle and ready for a new task." : "Ready for a new task."}</>;
  }
  return (
    <Facts>
      {workers.length === 0 ? null : (
        <span>
          <WorkingLine workers={workers} />
        </span>
      )}
      {parts.map((part) => (
        <Fact key={part.key} count={part.count} urgent={part.key === "needs"} onClick={part.open}>
          {part.text}
        </Fact>
      ))}
    </Facts>
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
        <Count value={props.items.length} />
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

// With no department yet, Home offers one only after a task finishes, built from that task.
function Suggest({ item }: { item: Item }) {
  const prompt = useApp((state) => state.tasks[item.id]?.task.prompt ?? item.title);
  return (
    <div className={styles.suggest}>
      <p>
        A department can take on work like "{item.title}": a lead plans it and hands parts to its
        people.
      </p>
      <Button
        onClick={() =>
          navigate({ name: "new-department", describe: `A team for work like this: ${prompt}` })
        }
      >
        <Plus size={14} aria-hidden />
        Make this a department
      </Button>
    </div>
  );
}

function Team({ items }: { items: Item[] }) {
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
  const hasTeam = chiefId !== undefined || list.length > 0;
  const finished = hasTeam
    ? undefined
    : items
        .filter(
          (item) => item.team === "solo" && (item.status === "review" || item.status === "done"),
        )
        .toSorted((a, b) => b.activityAt.localeCompare(a.activityAt))[0];
  if (!hasTeam && solo.length === 0 && finished === undefined) return null;

  return (
    <section className={styles.card} aria-labelledby="team-title">
      <h2 id="team-title" className={styles.cardTitle}>
        Your team
      </h2>
      {!hasTeam && solo.length === 0 ? null : (
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
                icon={
                  <Avatar
                    name={department.name}
                    colour={records[department.leadAgentId]?.colour ?? "var(--text-3)"}
                    size={20}
                  />
                }
                name={department.name}
                line={
                  goal === undefined
                    ? `${peopleLine(members)} · no task in progress`
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
                  <span className={styles.chip}>
                    {STATE_LABELS[stateOf(agent, traces, waiting)]}
                  </span>
                }
                onOpen={() => selectAgent(agent.id)}
              />
            );
          })}
        </ul>
      )}
      {list.length > SHOWN_TEAM ? (
        <Button variant="ghost" onClick={() => navigate({ name: "team" })}>
          All {list.length} departments
        </Button>
      ) : null}
      {hasTeam ? (
        <div className={styles.create}>
          <Button onClick={() => navigate({ name: "new-department" })}>
            <Plus size={14} aria-hidden />
            New department
          </Button>
        </div>
      ) : finished === undefined ? null : (
        <div className={solo.length > 0 ? styles.create : undefined}>
          <Suggest item={finished} />
        </div>
      )}
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

// One next step for a new user, the first tutorial not done; the full list is in Help.
function NextStep() {
  const hidden = useApp((state) => state.onboarding?.checklistHidden === true);
  const tutorial = useNextTutorial();
  if (hidden || tutorial === undefined) return null;
  return (
    <section className={styles.next} aria-labelledby="next-title">
      <GraduationCap size={18} className={styles.nextIcon} aria-hidden />
      <span className={styles.nextText}>
        <h2 id="next-title" className={styles.nextTitle}>
          Next step: {tutorial.title}
        </h2>
        <span className={styles.nextLine}>{tutorial.summary}</span>
      </span>
      <span className={styles.nextActions}>
        <Button variant="ghost" onClick={() => void saveOnboarding({ checklistHidden: true })}>
          Hide
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: "help" })}>
          All tutorials
        </Button>
        <Button variant="primary" onClick={() => void startTutorial(tutorial.id)}>
          Start tutorial
        </Button>
      </span>
    </section>
  );
}

// The screen the app opens on: what needs you, what is at work and what to review, then the rest.
export function HomeView() {
  const greeting = useGreeting();
  const now = useNow();
  const items = useTaskItems(now).filter((item) => item.goalId === undefined);
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
        <NextStep />
        <Composer home />
        <StoppedTasksCard />
        <UsagePauses />
        <LimitStops />
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
          <Team items={items} />
        </div>
        <AutomationsCard />
        <PlanUsageCard className={styles.card} />
      </div>
    </section>
  );
}
