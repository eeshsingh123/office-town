import type { AgentRecord, DepartmentRecord, TaskRecord } from "@office-town/contract";
import { ArrowUpRight, Users } from "lucide-react";
import { useMemo } from "react";
import { type Agent, stateOf, useWaitingSessions, workOf } from "../../store/agents.ts";
import { navigate, select, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { mainPath, useWorkspaces } from "../../store/workspaces.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import office from "../office/Office.module.css";
import {
  Facts,
  PanelHeader,
  PanelSection,
  PanelSettings,
  StateChip,
} from "../office/SidePanel.tsx";
import { tokenLine } from "../task/run-facts.ts";
import { StopTeamButton } from "../task/StopTeamButton.tsx";
import styles from "./DepartmentPanel.module.css";
import { totalOf } from "./usage.ts";

interface Member {
  record: AgentRecord;
  // Its work on the department's latest goal, if it took part.
  work?: Agent;
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
  const state =
    work === undefined ? undefined : stateOf(work, traces, waitingSessions.has(work.latest.id));
  const trace = work === undefined ? undefined : traces[work.latest.id];
  const step = trace === undefined ? undefined : progressOf(trace).step;
  const doing =
    state === undefined
      ? "Not on this goal"
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
  const workspace = useWorkspaces()?.find((known) => known.id === department.workspaceId);
  const { task, members, goalSessions } = useDepartmentGoal(department);
  const usage = useMemo(() => totalOf(task?.usage ?? []), [task]);

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

      <PanelSection title="Runs on">
        <Facts
          facts={[
            <span key="permissions" title={AUTONOMY[department.autonomy].description}>
              {AUTONOMY[department.autonomy].label}
            </span>,
            workspace === undefined ? undefined : (
              <button
                key="workspace"
                type="button"
                className={styles.factLink}
                title={mainPath(workspace)}
                onClick={() => navigate({ name: "workspace", workspaceId: department.workspaceId })}
              >
                {workspace.name}
              </button>
            ),
            goalSessions.length === 0 ? undefined : tokenLine(usage),
          ]}
        />
      </PanelSection>
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
