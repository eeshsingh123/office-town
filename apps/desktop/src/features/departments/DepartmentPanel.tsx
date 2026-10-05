import type { AgentRecord, DepartmentRecord, TaskRecord } from "@office-town/contract";
import { Settings } from "lucide-react";
import { useEffect, useMemo } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useWaitingSessions, workOf } from "../../store/agents.ts";
import { navigate, select, useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { useLoaded } from "../../ui/use-loaded.ts";
import office from "../office/Office.module.css";
import { MessageBox } from "../task/MessageBox.tsx";
import { StopTeamButton } from "../task/StopTeamButton.tsx";
import styles from "./DepartmentPanel.module.css";
import { Usage } from "./Usage.tsx";

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
  // Read again whenever a member's session or state changes, which is when delegations open or end.
  const signature = members.map(({ work }) => `${work?.latest.id}:${work?.latest.status}`).join();
  const delegations = useLoaded(`${task.id}|${signature}`, () => api.listDelegations(task.id));
  const open = (delegations.value ?? []).filter((one) => one.status === "working");
  if (open.length === 0) return null;
  const names = new Map(members.map(({ record }) => [record.id, record.name]));
  return (
    <section aria-labelledby="delegations-title">
      <h3 id="delegations-title" className={styles.title}>
        Open delegations
      </h3>
      <ul className={styles.delegations}>
        {open.map((delegation) => (
          <li key={delegation.id}>
            <strong>{names.get(delegation.workerAgentId) ?? "A guest"}</strong>
            <span className={styles.brief}>{taskTitle(delegation.brief)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A department: its members and their state, its open delegations, usage and autonomy, and what
// can be done to the whole team (MODULES M4.9).
export function DepartmentPanel({ department }: { department: DepartmentRecord }) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const workspaces = useLoaded("workspaces", api.listWorkspaces);
  const workspace = workspaces.value?.find((known) => known.id === department.workspaceId);

  const { task, members, goalSessions } = useMemo(() => {
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
    const goalSessions = (task === undefined ? [] : (tasks[task.id]?.sessionIds ?? [])).flatMap(
      (id) => sessions[id] ?? [],
    );
    return { task, members, goalSessions };
  }, [agents, tasks, sessions, department]);

  // Usage counts every session of the goal, finished ones included.
  useEffect(() => {
    for (const session of goalSessions) loadTrace(session.id);
  }, [goalSessions]);

  const lead = members.find(({ record }) => record.id === department.leadAgentId)?.work;
  const working = goalSessions.some(isOpen);

  return (
    <aside className={office.panel} aria-label={`${department.name}, department`}>
      <div className={styles.head}>
        <span className={`${styles.dot} ${working ? styles.dotWorking : ""}`} aria-hidden />
        <h2 className={styles.name}>{department.name}</h2>
        <Button
          variant="ghost"
          onClick={() => navigate({ name: "department", departmentId: department.id })}
        >
          <Settings size={14} aria-hidden />
          Settings
        </Button>
      </div>

      <dl className={styles.facts}>
        <dt>Working on</dt>
        <dd>
          {task === undefined ? (
            "No goal yet"
          ) : (
            <button
              type="button"
              className={office.taskLink}
              onClick={() => navigate({ name: "task", taskId: task.id })}
            >
              {taskTitle(task.prompt)}
            </button>
          )}
        </dd>
        <dt>Autonomy</dt>
        <dd title={AUTONOMY[department.autonomy].description}>
          {AUTONOMY[department.autonomy].label}
        </dd>
        <dt>Workspace</dt>
        <dd className={styles.path} title={workspace?.folders[0]}>
          {workspace?.folders[0] ?? ""}
        </dd>
      </dl>

      <section aria-labelledby="members-title">
        <h3 id="members-title" className={styles.title}>
          Members
        </h3>
        {members.map((member) => (
          <MemberLine
            key={member.record.id}
            member={member}
            lead={member.record.id === department.leadAgentId}
          />
        ))}
      </section>

      {task === undefined ? null : <OpenDelegations task={task} members={members} />}
      <Usage sessions={goalSessions} />

      <div className={office.panelActions}>
        {task === undefined ? (
          <Button variant="primary" onClick={() => navigate({ name: "new-task" })}>
            Give it a goal
          </Button>
        ) : null}
        {working && task !== undefined ? (
          <StopTeamButton taskId={task.id} label="Stop team" />
        ) : null}
      </div>
      {lead === undefined ? null : <MessageBox agent={lead} className={office.message} />}
    </aside>
  );
}
