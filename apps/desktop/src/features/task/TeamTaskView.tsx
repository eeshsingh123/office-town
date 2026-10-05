import { ArrowLeft, ExternalLink, Square } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { type Agent, agentsInTask, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { isOpen } from "../../store/records.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { useFollow } from "./follow.ts";
import { MessageBox } from "./MessageBox.tsx";
import { MemberLinks } from "./members.ts";
import { SessionTrace } from "./SessionTrace.tsx";
import styles from "./TaskView.module.css";
import team from "./TeamTaskView.module.css";

function MemberRow({
  agent,
  chosen,
  waiting,
  onChoose,
}: {
  agent: Agent;
  chosen: boolean;
  waiting: boolean;
  onChoose: () => void;
}) {
  const traces = useApp((state) => state.traces);
  const harness = useHarnessName(agent.latest.options.harness);
  const state = stateOf(agent, traces, waiting);
  const trace = traces[agent.latest.id];
  const step = trace === undefined ? undefined : progressOf(trace).step;
  const doing =
    state === "working" && step !== undefined
      ? `Step ${step.number} · ${step.title}`
      : state === "waiting"
        ? "Waiting for you"
        : STATE_LABELS[state];
  return (
    <button
      type="button"
      className={team.member}
      aria-current={chosen ? "true" : undefined}
      onClick={onChoose}
    >
      <Avatar name={agent.name} colour={agent.colour} size={26} />
      <span className={team.memberText}>
        <span>
          <strong>{agent.name}</strong>
          {agent.record.role === undefined ? null : (
            <span className={team.faint}> · {agent.record.role.toLowerCase()}</span>
          )}
        </span>
        <span className={`${team.doing} ${state === "waiting" ? team.waiting : ""}`}>
          <StatusIcon state={state} size={12} />
          {doing}
        </span>
        <span className={team.faint}>
          {harness}
          {agent.latest.options.model === undefined ? "" : ` · ${agent.latest.options.model}`}
        </span>
      </span>
    </button>
  );
}

// A team's task: its agents as a tree by delegation, the lead at the top, each opening its own
// trace (MODULES M4.5).
export function TeamTaskView({ taskId }: { taskId: string }) {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const departments = useApp((state) => state.departments);
  const traces = useApp((state) => state.traces);
  const waitingSessions = useWaitingSessions();
  const task = tasks[taskId]?.task;
  const members = useMemo(
    () => agentsInTask({ agents, tasks, sessions }, taskId),
    [agents, tasks, sessions, taskId],
  );
  const lead = members.find((member) => member.id === task?.leadAgentId) ?? members[0];
  const [chosenId, setChosenId] = useState<string>();
  const shown = members.find((member) => member.id === chosenId) ?? lead;
  const trace = shown === undefined ? undefined : traces[shown.latest.id];
  const follow = useFollow(`${shown?.id}:${trace?.position}:${trace?.streaming[""]?.length}`);
  if (task === undefined || lead === undefined || shown === undefined) {
    return <p className={styles.loading}>Loading the task…</p>;
  }

  const department = task.departmentId === undefined ? undefined : departments[task.departmentId];
  const workers = members.filter((member) => member.id !== lead.id);
  const states = members.map((member) =>
    stateOf(member, traces, waitingSessions.has(member.latest.id)),
  );
  const working = states.filter((state) => state === "working" || state === "starting").length;
  const asking = states.filter((state) => state === "waiting").length;
  const open = members.some((member) => isOpen(member.latest));
  const folder = lead.latest.options.workspacePath;
  const continueLead =
    shown.id === lead.id && shown.latest.status === "interrupted"
      ? async (prompt: string) => {
          await api.continueTask(taskId, prompt);
          await track(taskId);
        }
      : undefined;

  return (
    <section className={styles.view} aria-labelledby="task-title">
      <header className={styles.header}>
        <Button variant="ghost" onClick={() => navigate({ name: "office" })}>
          <ArrowLeft size={14} aria-hidden />
          Office
        </Button>
        <div className={styles.heading}>
          <div className={styles.titleLine}>
            <h1 id="task-title">{taskTitle(task.prompt)}</h1>
          </div>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <span className={team.dot} aria-hidden />
              {department?.name ?? "Proposing a team"}
            </span>
            {department === undefined ? null : (
              <span className={styles.chip}>{AUTONOMY[department.autonomy].label}</span>
            )}
            <span className={styles.chip}>
              {working} working{asking === 0 ? "" : ` · ${asking} waiting for you`}
            </span>
            <span className={styles.chip}>Started {clockTime(task.createdAt)}</span>
          </div>
        </div>
        {shell !== undefined && folder !== undefined ? (
          <Button variant="ghost" onClick={() => void shell?.openFolder(folder)}>
            <ExternalLink size={14} aria-hidden />
            Open folder
          </Button>
        ) : null}
        {open ? (
          <Button onClick={() => void api.stopTeam(taskId)}>
            <Square size={12} aria-hidden />
            Stop team
          </Button>
        ) : null}
      </header>
      <div className={styles.body}>
        <nav className={team.members} aria-label="Who works on this">
          <span className={team.label}>Who works on this</span>
          <MemberRow
            agent={lead}
            chosen={shown.id === lead.id}
            waiting={waitingSessions.has(lead.latest.id)}
            onChoose={() => setChosenId(lead.id)}
          />
          {workers.length === 0 ? null : (
            <div className={team.nest}>
              {workers.map((worker) => (
                <MemberRow
                  key={worker.id}
                  agent={worker}
                  chosen={shown.id === worker.id}
                  waiting={waitingSessions.has(worker.latest.id)}
                  onChoose={() => setChosenId(worker.id)}
                />
              ))}
            </div>
          )}
        </nav>
        <MemberLinks.Provider value={setChosenId}>
          <div className={styles.column}>
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
              </div>
            </div>
            <div className={styles.traceWidth}>
              <MessageBox agent={shown} onResume={continueLead} />
            </div>
          </div>
        </MemberLinks.Provider>
      </div>
    </section>
  );
}
