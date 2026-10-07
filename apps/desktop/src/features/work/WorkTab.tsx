import type { DepartmentRecord, PlanPiece } from "@office-town/contract";
import { Lock } from "lucide-react";
import { useEffect } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { clockTime, taskTitle } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { selectRoom } from "../office/office-state.ts";
import { Plan } from "../task/AgentAside.tsx";
import { DELEGATION_STATUS } from "./delegation-status.ts";
import { PieceIcon } from "./PieceIcon.tsx";
import { useChiefGoals } from "./use-chief-goals.ts";
import { departmentName, usePlan } from "./use-plan.ts";
import styles from "./Work.module.css";

const BLOCKERS = new Set<PlanPiece["status"]>(["failed", "stopped", "dropped"]);

export function upstreamOf(piece: PlanPiece, plan: readonly PlanPiece[]): PlanPiece[] {
  const found = new Map<string, PlanPiece>();
  const visit = (one: PlanPiece) => {
    for (const id of one.waitsOn) {
      const upstream = plan.find((each) => each.id === id);
      if (upstream === undefined || found.has(id)) continue;
      found.set(id, upstream);
      visit(upstream);
    }
  };
  visit(piece);
  return [...found.values()];
}

function PieceRow({ piece, plan }: { piece: PlanPiece; plan: PlanPiece[] }) {
  const departments = useApp((state) => state.departments);
  const waitsOn = plan.filter((one) => piece.waitsOn.includes(one.id));
  const blocked = piece.status === "waiting" && waitsOn.some((one) => BLOCKERS.has(one.status));
  const { departmentId } = piece;
  return (
    <li>
      <button
        type="button"
        className={styles.piece}
        disabled={departmentId === undefined}
        onClick={() => {
          if (departmentId !== undefined) selectRoom(departmentId);
        }}
      >
        <PieceIcon status={piece.status} />
        <span className={styles.pieceText}>
          <strong>{piece.title}</strong>
          <span className={styles.meta}>
            {departmentName(piece, departments)}
            {blocked ? <span className={styles.bad}> · blocked</span> : null}
            {waitsOn.length === 0
              ? ""
              : ` · Waits on: ${waitsOn.map((one) => one.title).join(", ")}`}
          </span>
          <span className={styles.brief}>{piece.brief}</span>
          {piece.status === "done" && piece.result !== undefined ? (
            <span className={styles.result}>
              <span className={styles.label}>Result</span> {piece.result}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function ChiefWork({ chiefId }: { chiefId: string }) {
  const { current, queue } = useChiefGoals(chiefId);
  const plan = usePlan(current?.id);
  const done = plan.filter((piece) => piece.status === "done").length;
  return (
    <>
      {current === undefined ? (
        <p className={styles.quiet}>The chief has no goal yet. Give it one from New task.</p>
      ) : (
        <section aria-label="Plan">
          <h3 className={styles.goal}>{taskTitle(current.prompt)}</h3>
          <p className={styles.meta}>
            Started {clockTime(current.createdAt)}
            {plan.length === 0
              ? " · no plan approved yet"
              : ` · ${done} of ${plan.length} pieces done`}
          </p>
          <ul className={styles.list}>
            {plan.map((piece) => (
              <PieceRow key={piece.id} piece={piece} plan={plan} />
            ))}
          </ul>
        </section>
      )}
      {queue.length === 0 ? null : (
        <section aria-label="Queue">
          <h3 className={styles.title}>Queue</h3>
          <ul className={styles.list}>
            {queue.map((task, index) => (
              <li key={task.id} className={styles.queued}>
                <PieceIcon status="queued" />
                {taskTitle(task.prompt)}
                {index === 0 ? <span className={styles.meta}> · starts next</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PieceOfGoal({ piece, department }: { piece: PlanPiece; department: DepartmentRecord }) {
  const plan = usePlan(piece.taskId);
  const departments = useApp((state) => state.departments);
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const goal = useApp((state) => state.tasks[piece.taskId]?.task);
  const workspaces = useLoaded("workspaces", api.listWorkspaces);
  const upstream = upstreamOf(piece, plan);
  const direct = plan.filter((one) => piece.waitsOn.includes(one.id) && one.result);
  const folderOf = (one: PlanPiece) => {
    const id =
      one.departmentId === undefined
        ? one.newDepartment?.workspaceId
        : departments[one.departmentId]?.workspaceId;
    return workspaces.value?.find((known) => known.id === id)?.folders ?? [];
  };
  const own = new Set(
    workspaces.value?.find((known) => known.id === department.workspaceId)?.folders,
  );
  const readOnly = [...new Set(upstream.flatMap(folderOf))].filter((folder) => !own.has(folder));
  const index = plan.findIndex((one) => one.id === piece.id);
  return (
    <>
      <p className={styles.meta}>
        Piece {index + 1} of {plan.length}
        {goal === undefined ? "" : ` in ${taskTitle(goal.prompt)}`} · from{" "}
        {chief?.name ?? "the chief"}
      </p>
      {direct.map((one) => (
        <p key={one.id} className={styles.result}>
          <span className={styles.label}>From {departmentName(one, departments)}</span> {one.result}
        </p>
      ))}
      {readOnly.map((folder) => (
        <p key={folder} className={styles.folder} title="Read-only">
          <Lock size={12} aria-label="Read-only" />
          Can read {folder}
        </p>
      ))}
    </>
  );
}

export function DepartmentWork({ department }: { department: DepartmentRecord }) {
  const tasks = useApp((state) => state.tasks);
  const pieces = useApp((state) => state.pieces);
  const delegations = useApp((state) => state.delegations);
  const agents = useApp((state) => state.agents);
  const task = Object.values(tasks)
    .map((entry) => entry.task)
    .filter((one) => one.departmentId === department.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const piece = Object.values(pieces).find((one) => one.pieceTaskId === task?.id);
  const handed = Object.values(delegations)
    .filter((one) => one.taskId === task?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const queued = Object.values(pieces)
    .filter(
      (one) =>
        one.departmentId === department.id &&
        one.pieceTaskId === undefined &&
        (one.status === "queued" || one.status === "waiting"),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <>
      <section aria-label="Goal">
        <h3 className={styles.title}>Goal</h3>
        {task === undefined ? (
          <p className={styles.quiet}>No goal yet.</p>
        ) : (
          <>
            <p className={styles.goal}>{taskTitle(task.prompt)}</p>
            {piece === undefined ? null : <PieceOfGoal piece={piece} department={department} />}
          </>
        )}
      </section>
      {handed.length === 0 ? null : (
        <section aria-label="Delegations">
          <h3 className={styles.title}>Delegations</h3>
          <ul className={styles.list}>
            {handed.map((one) => {
              const worker = agents[one.workerAgentId];
              return (
                <li key={one.id} className={styles.delegation}>
                  {worker === undefined ? null : (
                    <Avatar name={worker.name} colour={worker.colour} size={22} />
                  )}
                  <span className={styles.pieceText}>
                    <strong>{taskTitle(one.brief)}</strong>
                    <span className={styles.meta}>
                      {worker?.name ?? "A worker"} · {DELEGATION_STATUS[one.status].label}
                      {one.endedAt === undefined ? "" : ` ${clockTime(one.endedAt)}`}
                    </span>
                  </span>
                  <PieceIcon status={DELEGATION_STATUS[one.status].state} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {queued.length === 0 ? null : (
        <section aria-label="Queue">
          <h3 className={styles.title}>Queue · pieces that start when they can</h3>
          <ul className={styles.list}>
            {queued.map((one) => {
              const goal = tasks[one.taskId]?.task;
              return (
                <li key={one.id} className={styles.queued}>
                  <PieceIcon status={one.status} />
                  <span className={styles.pieceText}>
                    <strong>{one.title}</strong>
                    <span className={styles.meta}>
                      From the chief
                      {goal === undefined ? "" : ` · ${taskTitle(goal.prompt)}`} · {one.status}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

export function AgentWork({ agent }: { agent: Agent }) {
  const trace = useApp((state) => state.traces[agent.latest.id]);
  useEffect(() => loadTrace(agent.latest.id), [agent.latest.id]);
  const progress = trace === undefined ? undefined : progressOf(trace);
  return (
    <>
      <p className={styles.goal}>{taskTitle(agent.task.prompt)}</p>
      {trace === undefined || trace.plan.length === 0 ? (
        <p className={styles.quiet}>No steps yet: the agent has not made a plan for this task.</p>
      ) : (
        <Plan plan={trace.plan} />
      )}
      {progress?.current === undefined ? null : (
        <p className={styles.meta}>Now: {progress.current.title}</p>
      )}
    </>
  );
}
