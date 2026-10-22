import { Fragment, useMemo, useState } from "react";
import { type Agent, agentsInTask, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { type AgentState, progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { byRole, roleNumber } from "../departments/team-form.ts";
import { OutputsPane } from "../outputs/OutputsPane.tsx";
import { TaskTabs, useTaskTab } from "../outputs/TaskTabs.tsx";
import { useModelName } from "../profiles/model-line.ts";
import { useFollow } from "./follow.ts";
import { MessageBox } from "./MessageBox.tsx";
import { MemberLinks } from "./members.ts";
import { ReviewDialog } from "./ReviewDialog.tsx";
import { ReviewOffer } from "./ReviewOffer.tsx";
import { RunCard } from "./RunCard.tsx";
import { SessionTrace } from "./SessionTrace.tsx";
import { StopTeamButton } from "./StopTeamButton.tsx";
import { ReviewAction } from "./TaskTools.tsx";
import styles from "./TaskView.module.css";
import team from "./TeamTaskView.module.css";

function MemberRow({
  agent,
  state,
  chosen,
  lead = false,
  number,
  visiting = false,
  onChoose,
}: {
  agent: Agent;
  state: AgentState;
  chosen: boolean;
  lead?: boolean;
  number?: number | undefined;
  visiting?: boolean;
  onChoose: () => void;
}) {
  const traces = useApp((state) => state.traces);
  const harness = useHarnessName(agent.latest.options.harness);
  const trace = traces[agent.latest.id];
  const model = useModelName(agent.latest.options, trace?.model ?? agent.latest.options.model);
  const progress = trace === undefined ? undefined : progressOf(trace);
  const step = progress?.step;
  const doing =
    state === "working" && step !== undefined
      ? `Step ${step.number} of ${progress?.stepCount} · ${step.title}`
      : state === "waiting"
        ? "Waiting for you"
        : STATE_LABELS[state];
  const role = agent.record.role?.trim();
  const classes = [
    team.member,
    lead ? team.lead : "",
    visiting ? team.visitor : "",
    state === "stopped" || state === "interrupted" ? team.quiet : "",
  ];
  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-current={chosen ? "true" : undefined}
      onClick={onChoose}
    >
      <Avatar name={agent.name} colour={agent.colour} size={lead ? 32 : 26} />
      <span className={team.memberText}>
        <span className={team.nameLine}>
          <strong>{agent.name}</strong>
          {lead ? <span className={team.leadChip}>Lead</span> : null}
          {number === undefined ? null : <span className={team.number}>No. {number}</span>}
        </span>
        {(lead || visiting) && role !== undefined && role.toLowerCase() !== "lead" ? (
          <span className={team.role}>{role}</span>
        ) : null}
        <span className={`${team.doing} ${state === "waiting" ? team.waiting : ""}`}>
          <StatusIcon state={state} size={12} />
          <span className={team.ellipsis}>{doing}</span>
        </span>
        <span className={team.model}>
          {harness} · {model}
        </span>
      </span>
    </button>
  );
}

const SUMMARY: [string, readonly AgentState[]][] = [
  ["waiting", ["waiting"]],
  ["at work", ["starting", "working"]],
  ["done", ["idle", "done"]],
  ["failed", ["failed"]],
  ["stopped", ["stopped", "interrupted"]],
];

// "1 at work · 2 done", with what needs the user first.
function summaryOf(states: readonly AgentState[]): string {
  return SUMMARY.flatMap(([word, kinds]) => {
    const count = states.filter((state) => kinds.includes(state)).length;
    return count === 0 ? [] : `${count} ${word}`;
  }).join(" · ");
}

// The team as a tree by delegation, lead at the top, guests apart.
export function TeamTaskView({ taskId }: { taskId: string }) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const departments = useApp((state) => state.departments);
  const chiefId = useApp((state) => state.chiefId);
  const traces = useApp((state) => state.traces);
  const waitingSessions = useWaitingSessions();
  const task = tasks[taskId]?.task;
  const members = useMemo(
    () => agentsInTask({ agents, tasks, sessions }, taskId),
    [agents, tasks, sessions, taskId],
  );
  const lead = members.find((member) => member.id === task?.leadAgentId) ?? members[0];
  const [chosenId, setChosenId] = useState<string>();
  const [asking, setAsking] = useState(false);
  const tab = useTaskTab(taskId);
  const shown = members.find((member) => member.id === chosenId) ?? lead;
  const trace = shown === undefined ? undefined : traces[shown.latest.id];
  const follow = useFollow(`${shown?.id}:${trace?.position}:${trace?.streaming[""]?.length}`);
  if (task === undefined || lead === undefined || shown === undefined) {
    return <p className={styles.loading}>Loading the task…</p>;
  }

  const department = task.departmentId === undefined ? undefined : departments[task.departmentId];
  const workers = members.filter((member) => member.id !== lead.id && !member.record.guest);
  const visitors = members.filter((member) => member.record.guest === true);
  const stateById = new Map(
    members.map((member) => [
      member.id,
      stateOf(member, traces, waitingSessions.has(member.latest.id)),
    ]),
  );
  const states = [...stateById.values()];
  const groups = byRole(workers, (worker) => worker.record.role);
  const working = states.filter((state) => state === "working" || state === "starting").length;
  const waitingCount = states.filter((state) => state === "waiting").length;
  const open = members.some((member) => isOpen(member.latest));
  return (
    <section className={styles.view} aria-labelledby="task-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <Crumbs
            items={[
              { label: "Tasks", view: { name: "tasks" } },
              ...(department !== undefined
                ? [
                    {
                      label: department.name,
                      view: { name: "office", room: department.id } as const,
                    },
                  ]
                : task.leadAgentId !== undefined && task.leadAgentId === chiefId
                  ? [{ label: "Chief", view: { name: "chief" } as const }]
                  : []),
              { label: taskTitle(task.prompt) },
            ]}
          />
          <div className={styles.titleLine}>
            <h1 id="task-title">{taskTitle(task.prompt)}</h1>
          </div>
          <div className={styles.chips}>
            {task.leadAgentId === undefined ? null : (
              <span className={styles.chip}>
                <span className={team.dot} aria-hidden />
                {task.workerAgentIds !== undefined
                  ? `${lead.name}'s group · ${task.workerAgentIds.length + 1} agents`
                  : (department?.name ?? "Proposing a team")}
              </span>
            )}
            <span className={styles.chip}>
              {working} working{waitingCount === 0 ? "" : ` · ${waitingCount} waiting for you`}
            </span>
          </div>
        </div>
        <TaskTabs taskId={taskId} />
        {open ? (
          <StopTeamButton
            taskId={taskId}
            label={task.leadAgentId === undefined ? "Stop all" : "Stop team"}
          />
        ) : null}
      </header>
      {tab.outputs ? (
        <OutputsPane taskId={taskId} chosen={tab.output} onChoose={tab.choose} />
      ) : (
        <div className={styles.body}>
          <nav className={team.members} aria-label="Who works on this">
            <div className={team.heading}>
              <span className={team.label}>Who works on this</span>
              <span className={team.headCount}>
                {members.length - visitors.length} people
                {working === 0 ? "" : ` · ${working} at work`}
              </span>
            </div>
            <MemberRow
              agent={lead}
              state={stateById.get(lead.id) ?? "idle"}
              chosen={shown.id === lead.id}
              lead
              onChoose={() => setChosenId(lead.id)}
            />
            {workers.length === 0 ? null : (
              <div className={team.tree}>
                {groups.map(({ role, people }, index) => (
                  <Fragment key={role}>
                    <div className={`${team.branch} ${team.group}`}>
                      <span className={team.groupName}>{role || "Team"}</span>
                      <span className={team.groupCount}>{people.length}</span>
                      <span className={team.groupSummary}>
                        {summaryOf(people.map((one) => stateById.get(one.id) ?? "idle"))}
                      </span>
                    </div>
                    {people.map((worker, at) => {
                      const state = stateById.get(worker.id) ?? "idle";
                      const last = index === groups.length - 1 && at === people.length - 1;
                      const live = state === "working" || state === "starting";
                      return (
                        <div
                          key={worker.id}
                          className={`${team.branch} ${last ? team.last : ""} ${live ? team.live : ""}`}
                        >
                          <MemberRow
                            agent={worker}
                            state={state}
                            chosen={shown.id === worker.id}
                            number={
                              people.length > 1 ? roleNumber(worker.record.role ?? "") : undefined
                            }
                            onChoose={() => setChosenId(worker.id)}
                          />
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            )}
            {visitors.length === 0 ? null : (
              <>
                <span className={`${team.label} ${team.visiting}`}>Reviewers</span>
                {visitors.map((visitor) => (
                  <MemberRow
                    key={visitor.id}
                    agent={visitor}
                    chosen={shown.id === visitor.id}
                    state={stateById.get(visitor.id) ?? "idle"}
                    visiting
                    onChoose={() => setChosenId(visitor.id)}
                  />
                ))}
              </>
            )}
          </nav>
          <MemberLinks.Provider value={setChosenId}>
            <div className={styles.column}>
              <RunCard agent={shown} />
              <div className={styles.scroll} ref={follow.ref} onScroll={follow.onScroll}>
                <div className={styles.traceWidth}>
                  {shown.sessions.map((session, index) => (
                    <Fragment key={session.id}>
                      {index === 0 ? null : (
                        <div className={styles.divider}>
                          Continued at {clockTime(session.createdAt)}
                        </div>
                      )}
                      <SessionTrace session={session} />
                    </Fragment>
                  ))}
                  {shown.id === lead.id ? (
                    <ReviewOffer
                      agent={lead}
                      members={members}
                      suggest
                      onReview={() => setAsking(true)}
                      onShow={setChosenId}
                    />
                  ) : null}
                </div>
              </div>
              <div className={`${styles.traceWidth} ${styles.dock}`}>
                <MessageBox
                  agent={shown}
                  actions={
                    shown.record.guest ? undefined : (
                      <ReviewAction onClick={() => setAsking(true)} />
                    )
                  }
                />
              </div>
            </div>
          </MemberLinks.Provider>
        </div>
      )}
      <ReviewDialog
        key={shown.id}
        agent={shown}
        open={asking}
        onOpenChange={setAsking}
        onStarted={setChosenId}
      />
    </section>
  );
}
