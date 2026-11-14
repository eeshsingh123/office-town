import type { AgentRecord, DepartmentRecord, TaskRecord } from "@office-town/contract";
import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import { type Agent, stateOf, useWaitingSessions, workOf } from "../../store/agents.ts";
import { navigate, select, useApp } from "../../store/app-store.ts";
import { teamAtWork } from "../../store/records.ts";
import { progressOf, stageOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ago, taskName, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { DepartmentAppList, useTeamAppCount } from "../connectors/DepartmentApps.tsx";
import office from "../office/Office.module.css";
import {
  PanelHeader,
  PanelSection,
  PanelSettings,
  SectionAction,
  StateChip,
} from "../office/SidePanel.tsx";
import { ResultRows } from "../outputs/OutputCards.tsx";
import { useResults } from "../outputs/use-task-outputs.ts";
import { tokenLine } from "../task/run-facts.ts";
import { StopTeamButton } from "../task/StopButton.tsx";
import styles from "./DepartmentPanel.module.css";
import { peopleLine } from "./team-line.ts";
import { totalOf } from "./usage.ts";

interface Member {
  record: AgentRecord;
  // Its work on the department's latest goal, if it took part.
  work?: Agent;
}

// What a member not on the latest goal did last, such as "Last: Build the hero · 2 h ago".
function useLastWork(agentId: string): string | undefined {
  const sessions = useApp((state) => state.sessions);
  const tasks = useApp((state) => state.tasks);
  const delegations = useApp((state) => state.delegations);
  return useMemo(() => {
    const latest = Object.values(sessions)
      .filter((session) => session.agentId === agentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest === undefined) return undefined;
    // A worker's piece of the goal is its brief; a lead's is the goal itself.
    const brief = Object.values(delegations)
      .filter((delegation) => delegation.workerSessionId === latest.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.brief;
    const task = tasks[latest.taskId]?.task;
    const what = brief === undefined ? task && taskName(task) : taskTitle(brief);
    if (what === undefined) return undefined;
    return `Last: ${what} · ${ago(latest.endedAt ?? latest.createdAt)}`;
  }, [agentId, sessions, tasks, delegations]);
}

function MemberLine({ member, lead }: { member: Member; lead: boolean }) {
  const traces = useApp((state) => state.traces);
  const waitingSessions = useWaitingSessions();
  const harness = useApp(
    (state) =>
      state.harnesses.find((known) => known.harness === member.record.settings.harness)?.name ??
      member.record.settings.harness,
  );
  const { record, work } = member;
  const lastWork = useLastWork(record.id);
  const state =
    work === undefined ? undefined : stateOf(work, traces, waitingSessions.has(work.latest.id));
  const trace = work === undefined ? undefined : traces[work.latest.id];
  const step = trace === undefined ? undefined : progressOf(trace).step;
  const doing =
    state === undefined
      ? (lastWork ?? "Free")
      : (stageOf(state, trace) ??
        (state === "working" && step !== undefined
          ? `Step ${step.number} · ${step.title}`
          : state === "waiting"
            ? "Needs you"
            : STATE_LABELS[state]));
  return (
    <button type="button" className={styles.member} onClick={() => select([record.id])}>
      <Avatar name={record.name} colour={record.colour} size={26} />
      <span className={styles.memberText}>
        <span>
          <strong>{record.name}</strong>
          <span className={styles.faint}>
            {" "}
            · {lead ? "lead" : (record.role?.toLowerCase() ?? "worker")} · {harness}
          </span>
        </span>
        <span className={`${styles.doing} ${state === "waiting" ? styles.waiting : ""}`}>
          {state === undefined ? null : <StatusIcon state={state} size={12} />}
          {doing}
        </span>
      </span>
    </button>
  );
}

function OpenDelegations({ task, members }: { task: TaskRecord; members: Member[] }) {
  const delegations = useApp((state) => state.delegations);
  const open = Object.values(delegations)
    .filter((one) => one.taskId === task.id && one.status === "working")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (open.length === 0) return null;
  const names = new Map(members.map(({ record }) => [record.id, record.name]));
  return (
    <PanelSection title="Handed out">
      <ul className={styles.delegations}>
        {open.map((delegation) => (
          <li key={delegation.id}>
            <strong>{names.get(delegation.workerAgentId) ?? "The checker"}</strong>
            <span className={styles.brief}>{taskTitle(delegation.brief)}</span>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

function useDepartmentGoal(department: DepartmentRecord) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  return useMemo(() => {
    const task = Object.values(tasks)
      .map((entry) => entry.task)
      .filter((one) => one.departmentId === department.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const known = { agents, tasks, sessions };
    const members: Member[] = Object.values(agents)
      .filter((agent) => agent.departmentId === department.id)
      .sort(
        (a, b) =>
          Number(b.id === department.leadAgentId) - Number(a.id === department.leadAgentId) ||
          a.createdAt.localeCompare(b.createdAt),
      )
      .map((record) => {
        const work = task === undefined ? undefined : workOf(known, record.id, task.id);
        return work === undefined ? { record } : { record, work };
      });
    // A guest called in to review is no member.
    const goalSessions = (task === undefined ? [] : (tasks[task.id]?.sessionIds ?? []))
      .flatMap((id) => sessions[id] ?? [])
      .filter((session) => agents[session.agentId]?.guest !== true);
    const working = task !== undefined && teamAtWork(task, goalSessions);
    return { task, members, goalSessions, working };
  }, [agents, tasks, sessions, department]);
}

export function DepartmentHeader({ department }: { department: DepartmentRecord }) {
  const { members, working } = useDepartmentGoal(department);
  const lead = useApp((state) => state.agents[department.leadAgentId]);
  return (
    <PanelHeader
      picture={<Avatar name={department.name} colour={lead?.colour ?? "var(--text-3)"} size={36} />}
      title={department.name}
      subtitle={`Department · ${peopleLine(members.length)}`}
      status={working ? <StateChip state="working" /> : undefined}
      actions={
        <PanelSettings
          label="Department settings"
          onClick={() => navigate({ name: "department", departmentId: department.id })}
        />
      }
    />
  );
}

// The latest few results of its goal; the rest are a click away.
const SHOWN_RESULTS = 3;

function DepartmentOutputs({ taskId }: { taskId: string }) {
  const results = useResults(taskId);
  if (results.length === 0) return null;
  return (
    <PanelSection
      title="Outputs"
      action={
        <SectionAction
          label={results.length > SHOWN_RESULTS ? `All ${results.length}` : "Open"}
          onClick={() => navigate({ name: "task", taskId, tab: "outputs" })}
        />
      }
    >
      <ResultRows outputs={results.slice(0, SHOWN_RESULTS)} />
    </PanelSection>
  );
}

// Every app the team can use, including those given to everyone (D-96).
function DepartmentAppsSection(props: { departmentId: string; harnesses: string[] }) {
  const count = useTeamAppCount(props.departmentId, props.harnesses);
  return (
    <PanelSection title={count === 0 ? "Apps" : `Apps · ${count}`}>
      <DepartmentAppList {...props} />
    </PanelSection>
  );
}

export function DepartmentNow({ department }: { department: DepartmentRecord }) {
  const { task, members, goalSessions, working } = useDepartmentGoal(department);
  const usage = useMemo(() => totalOf(task?.usage ?? []), [task]);
  return (
    <>
      <PanelSection title={working ? "Working on" : "Last task"}>
        {task === undefined ? (
          <p className={styles.faint}>No task yet</p>
        ) : (
          <button
            type="button"
            className={office.taskLink}
            onClick={() => navigate({ name: "task", taskId: task.id })}
          >
            {taskName(task)}
            <ArrowUpRight size={14} aria-hidden />
          </button>
        )}
      </PanelSection>

      <PanelSection title="Members">
        <div className={styles.memberList}>
          {members.map((member) => (
            <MemberLine
              key={member.record.id}
              member={member}
              lead={member.record.id === department.leadAgentId}
            />
          ))}
        </div>
      </PanelSection>

      {task === undefined ? null : <OpenDelegations task={task} members={members} />}

      <DepartmentAppsSection
        departmentId={department.id}
        harnesses={members.map(({ record }) => record.settings.harness)}
      />

      {task === undefined ? null : <DepartmentOutputs taskId={task.id} />}

      {goalSessions.length === 0 ? null : (
        <PanelSection title="Usage on this task">
          <p className={styles.usage}>{tokenLine(usage)}</p>
        </PanelSection>
      )}
    </>
  );
}

export function DepartmentFooter({ department }: { department: DepartmentRecord }) {
  const { task, working } = useDepartmentGoal(department);
  if (task === undefined) {
    return (
      <Button
        variant="primary"
        onClick={() => navigate({ name: "new-task", who: "team", departmentId: department.id })}
      >
        New task
      </Button>
    );
  }
  return (
    <>
      <Button variant="primary" onClick={() => navigate({ name: "task", taskId: task.id })}>
        Open task
      </Button>
      {working ? <StopTeamButton taskId={task.id} label="Stop team" /> : null}
    </>
  );
}
