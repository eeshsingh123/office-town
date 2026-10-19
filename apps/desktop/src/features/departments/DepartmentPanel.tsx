import type { AgentRecord, DepartmentRecord, TaskRecord } from "@office-town/contract";
import { ArrowUpRight, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useWaitingSessions, workOf } from "../../store/agents.ts";
import { navigate, select, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { ago, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import office from "../office/Office.module.css";
import {
  PanelHeader,
  PanelSection,
  PanelSettings,
  SectionAction,
  StateChip,
} from "../office/SidePanel.tsx";
import { tokenLine } from "../task/run-facts.ts";
import { StopTeamButton } from "../task/StopTeamButton.tsx";
import styles from "./DepartmentPanel.module.css";
import { DepartmentWorkspaces } from "./DepartmentWorkspaces.tsx";
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
    const what = brief ?? tasks[latest.taskId]?.task.prompt;
    if (what === undefined) return undefined;
    return `Last: ${taskTitle(what)} · ${ago(latest.endedAt ?? latest.createdAt)}`;
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
      : state === "working" && step !== undefined
        ? `Step ${step.number} · ${step.title}`
        : state === "waiting"
          ? "Waiting for you"
          : STATE_LABELS[state];
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
    <PanelSection title="Open delegations">
      <ul className={styles.delegations}>
        {open.map((delegation) => (
          <li key={delegation.id}>
            <strong>{names.get(delegation.workerAgentId) ?? "A guest"}</strong>
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
    return { task, members, goalSessions, working: goalSessions.some(isOpen) };
  }, [agents, tasks, sessions, department]);
}

export function DepartmentHeader({ department }: { department: DepartmentRecord }) {
  const { members, working } = useDepartmentGoal(department);
  return (
    <PanelHeader
      picture={
        <span className={styles.picture} aria-hidden>
          <Users size={18} />
        </span>
      }
      title={department.name}
      subtitle={`Department · ${members.length === 1 ? "1 member" : `${members.length} members`}`}
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

export function DepartmentNow({ department }: { department: DepartmentRecord }) {
  const { task, members, goalSessions, working } = useDepartmentGoal(department);
  const usage = useMemo(() => totalOf(task?.usage ?? []), [task]);
  const [failure, setFailure] = useState<string>();
  const setWorkspaces = async (workspaceIds: string[]) => {
    const {
      id: _,
      createdAt: _at,
      workspaceId: _default,
      leadAgentId: _lead,
      ...settings
    } = department;
    setFailure(undefined);
    try {
      await api.updateDepartment(department.id, { ...settings, workspaceIds });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <PanelSection title="Working on">
        {task === undefined ? (
          <p className={styles.faint}>No goal yet</p>
        ) : (
          <button
            type="button"
            className={office.taskLink}
            onClick={() => navigate({ name: "task", taskId: task.id })}
          >
            {taskTitle(task.prompt)}
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

      <PanelSection title="Workspaces">
        <DepartmentWorkspaces
          value={department.workspaceIds}
          onChange={setWorkspaces}
          departmentName={department.name}
          departmentId={department.id}
          goalWorkspaceId={working ? task?.workspaceId : undefined}
          keepOne
          compact
        />
        {working ? <p className={styles.note}>Changes apply from the next goal.</p> : null}
        {failure === undefined ? null : (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        )}
      </PanelSection>

      <PanelSection
        title="Permissions"
        action={
          <SectionAction
            label="Change"
            onClick={() => navigate({ name: "department", departmentId: department.id })}
          />
        }
      >
        <div className={styles.permission}>
          <strong>{AUTONOMY[department.autonomy].label}</strong>
          <span>{AUTONOMY[department.autonomy].description}</span>
        </div>
      </PanelSection>

      {goalSessions.length === 0 ? null : (
        <PanelSection title="Usage on this goal">
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
      <Button variant="primary" onClick={() => navigate({ name: "new-task" })}>
        Give it a goal
      </Button>
    );
  }
  return (
    <>
      <Button variant="primary" onClick={() => navigate({ name: "task", taskId: task.id })}>
        Open goal
      </Button>
      {working ? <StopTeamButton taskId={task.id} label="Stop team" /> : null}
    </>
  );
}
