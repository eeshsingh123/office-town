import type { DelegationRecord, MilestoneRecord, PlanStep } from "@office-town/contract";
import { ListChecks, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { useKept, writeKept } from "../../store/kept.ts";
import { useMilestones, useParts } from "../../store/milestones.ts";
import { isOpen } from "../../store/records.ts";
import { planIsStale } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { type PaneSize, paneFlag, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import { showToast } from "../../ui/Toast.tsx";
import {
  AddMilestone,
  MilestoneList,
  MiniBar,
  Segments,
  type ShownStatus,
  shownStatus,
} from "./Milestones.tsx";
import styles from "./Progress.module.css";
import { StepList } from "./ProgressSteps.tsx";
import task from "./TaskView.module.css";

const SIZE: PaneSize = { initial: 340, min: 280, max: 480 };
const HIDDEN = paneFlag("progress-hidden");
// Past this many, met milestones fold away so the open ones stay in view (owner).
const FOLD_PAST = 5;
const TITLE_LENGTH = 60;

const setHidden = (hidden: boolean) => writeKept(HIDDEN, hidden);

interface AgentPlan {
  plan: readonly PlanStep[];
  stale: boolean;
  live: boolean;
}

// A resumed session reports no plan until it changes, so the latest known one shows.
function usePlanOf(taskId: string, agentId: string | undefined): AgentPlan | undefined {
  const entry = useApp((state) => state.tasks[taskId]);
  const sessions = useApp((state) => state.sessions);
  const traces = useApp((state) => state.traces);
  if (entry === undefined || agentId === undefined) return undefined;
  const own = entry.sessionIds
    .map((id) => sessions[id])
    .filter((session) => session !== undefined && session.agentId === agentId);
  const latest = own.at(-1);
  const planned = own
    .map((session) => (session === undefined ? undefined : traces[session.id]))
    .findLast((trace) => trace !== undefined && trace.plan.length > 0);
  if (planned === undefined) return undefined;
  return {
    plan: planned.plan,
    stale: planIsStale(planned),
    live: latest !== undefined && isOpen(latest),
  };
}

export type ProgressKind = "milestones" | "steps" | "none";

// Milestones on, or any written, shows them; else a solo agent's steps, as before (D-95).
export function useProgressKind(taskId: string, soloAgentId?: string): ProgressKind {
  const record = useApp((state) => state.tasks[taskId]?.task);
  const chiefId = useApp((state) => state.chiefId);
  const milestones = useMilestones(taskId);
  const plan = usePlanOf(taskId, soloAgentId);
  if (record === undefined || (chiefId !== undefined && record.leadAgentId === chiefId)) {
    return "none";
  }
  if (record.milestones === true || milestones.length > 0) return "milestones";
  return plan === undefined ? "none" : "steps";
}

// In the task header; it shows or hides the column.
export function ProgressButton({ taskId, soloAgentId }: { taskId: string; soloAgentId?: string }) {
  const [hidden] = useKept(HIDDEN);
  const kind = useProgressKind(taskId, soloAgentId);
  const milestones = useMilestones(taskId).filter((one) => one.delegationId === undefined);
  const plan = usePlanOf(taskId, soloAgentId)?.plan ?? [];
  if (kind === "none") return null;
  const count =
    kind === "milestones"
      ? `${milestones.filter((one) => one.status === "met").length}/${milestones.length}`
      : `${plan.filter((step) => step.status === "completed").length}/${plan.length}`;
  return (
    <Button onClick={() => setHidden(!hidden)} aria-pressed={!hidden}>
      <ListChecks size={14} aria-hidden />
      {kind === "milestones" ? "Progress" : "Steps"} {count}
    </Button>
  );
}

function partTitle(part: DelegationRecord): string {
  if (part.title !== undefined) return part.title;
  const first = part.brief.split("\n")[0]?.trim() ?? "";
  return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH)}…` : first;
}

function PartPill({ part }: { part: DelegationRecord }) {
  if (part.accepted === "new")
    return <span className={`${styles.pill} ${styles.pillNew}`}>New</span>;
  if (part.status === "working") {
    const sent = part.sendBacks?.length ?? 0;
    if (sent === 0) return <span className={`${styles.pill} ${styles.pillAccent}`}>Working</span>;
    return (
      <span className={`${styles.pill} ${styles.pillWarn}`}>
        Sent back · {sent} of {part.sendBackLimit ?? 2}
      </span>
    );
  }
  if (part.status === "done")
    return <span className={`${styles.pill} ${styles.pillOk}`}>Done</span>;
  if (part.status === "failed") {
    return <span className={`${styles.pill} ${styles.pillBad}`}>Failed</span>;
  }
  return <span className={`${styles.pill} ${styles.pillQuiet}`}>Stopped</span>;
}

function Part({
  taskId,
  part,
  milestones,
  editable,
}: {
  taskId: string;
  part: DelegationRecord;
  milestones: readonly MilestoneRecord[];
  editable: boolean;
}) {
  const worker = useApp((state) => state.agents[part.workerAgentId]);
  const [open, setOpen] = useState(part.status === "working");
  const plan = usePlanOf(taskId, part.workerAgentId);
  const working = part.status === "working";
  const statusOf = (milestone: MilestoneRecord) => shownStatus(milestone, working, !working);
  const statuses = milestones.map(statusOf);
  const name = worker?.name ?? "A worker";
  const lastSent = part.sendBacks?.at(-1);
  const seen = () => {
    api.markPartSeen(part.id).catch(() => showToast("That could not be saved."));
  };
  return (
    <div className={`${styles.part} ${part.accepted === "new" ? styles.partNew : ""}`}>
      <button
        type="button"
        className={styles.partHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {worker === undefined ? (
          <span />
        ) : (
          <Avatar name={worker.name} colour={worker.colour} size={24} />
        )}
        <span className={styles.partName}>
          <strong title={partTitle(part)}>{partTitle(part)}</strong>
          <span>{name}</span>
        </span>
        <span className={styles.partRight}>
          <PartPill part={part} />
          {milestones.length === 0 ? null : (
            <span className={styles.fraction}>
              <MiniBar statuses={statuses} />
              {statuses.filter((status) => status === "met").length} of {milestones.length}
            </span>
          )}
        </span>
      </button>
      {open ? (
        <div className={styles.partBody}>
          {lastSent === undefined ? null : (
            <div className={styles.sentBack}>
              Sent back {part.sendBacks?.length} of {part.sendBackLimit ?? 2}: {lastSent.note}
            </div>
          )}
          <div className={styles.group}>
            <span className={styles.label}>{name}'s milestones</span>
            {milestones.length === 0 ? <p className={styles.note}>None for this part.</p> : null}
            <MilestoneList
              milestones={milestones}
              statusOf={statusOf}
              owner={name}
              editable={editable}
            />
            {editable ? (
              <AddMilestone
                label={`Add a milestone for ${name}`}
                owner={working ? name : undefined}
                onAdd={async (text) => {
                  await api.addMilestone(taskId, text, part.id);
                }}
              />
            ) : null}
          </div>
          {plan === undefined || worker === undefined ? null : (
            <div className={styles.group}>
              <span className={styles.label}>{name}'s steps</span>
              <StepList
                taskId={taskId}
                agent={worker}
                plan={plan.plan}
                stale={plan.stale}
                live={plan.live && working}
              />
            </div>
          )}
          {part.accepted === "new" ? (
            <div>
              <Button variant="primary" className={styles.small} onClick={seen}>
                Got it
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GoalList({
  taskId,
  milestones,
  owner,
  editable,
  finished,
}: {
  taskId: string;
  milestones: readonly MilestoneRecord[];
  owner: string | undefined;
  editable: boolean;
  finished: boolean;
}) {
  const [showMet, setShowMet] = useState(false);
  const met = milestones.filter((one) => one.status === "met").length;
  const folds = milestones.length > FOLD_PAST && met > 0;
  const shown = folds && !showMet ? milestones.filter((one) => one.status !== "met") : milestones;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.label}>What you'll get</span>
        {folds ? (
          <button type="button" className={styles.link} onClick={() => setShowMet(!showMet)}>
            {showMet ? "Hide met" : `Show ${met} met`}
          </button>
        ) : null}
      </div>
      {milestones.length === 0 ? (
        <p className={styles.note}>
          None yet. {owner ?? "The agent"} writes them first, and you can add your own.
        </p>
      ) : null}
      <MilestoneList
        milestones={shown}
        statusOf={(milestone) => shownStatus(milestone, false, finished)}
        owner={owner}
        editable={editable}
      />
      {editable ? (
        <AddMilestone
          label="Add a milestone"
          owner={owner}
          onAdd={async (text) => {
            await api.addMilestone(taskId, text);
          }}
        />
      ) : null}
    </div>
  );
}

// What the user gets, who does what and the steps, live; it takes the place of Steps (D-95).
export function ProgressColumn({ taskId, soloAgentId }: { taskId: string; soloAgentId?: string }) {
  const [hidden] = useKept(HIDDEN);
  const [width, resize] = usePaneWidth("progress", SIZE);
  const record = useApp((state) => state.tasks[taskId]?.task);
  const agents = useApp((state) => state.agents);
  const kind = useProgressKind(taskId, soloAgentId);
  const all = useMilestones(taskId);
  const parts = useParts(taskId);
  const soloPlan = usePlanOf(taskId, soloAgentId);
  if (hidden || kind === "none" || record === undefined) return null;
  const ownerId = record.leadAgentId ?? soloAgentId;
  const owner = ownerId === undefined ? undefined : agents[ownerId]?.name;
  const on = record.milestones === true;
  const finished = record.state === "ended";
  const goal = all.filter((one) => one.delegationId === undefined);
  const goalStatuses: ShownStatus[] = goal.map((one) => shownStatus(one, false, finished));
  const met = goalStatuses.filter((status) => status === "met").length;
  const soloAgent = soloAgentId === undefined ? undefined : agents[soloAgentId];
  const steps =
    soloPlan === undefined || soloAgent === undefined ? null : (
      <StepList
        taskId={taskId}
        agent={soloAgent}
        plan={soloPlan.plan}
        stale={soloPlan.stale}
        live={soloPlan.live}
      />
    );
  const stepsDone = soloPlan?.plan.filter((step) => step.status === "completed").length ?? 0;
  return (
    <aside className={task.steps} style={{ width }} aria-labelledby="progress-title">
      <div className={task.stepsHead}>
        <h2 id="progress-title">{kind === "milestones" ? "Progress" : "Steps"}</h2>
        <span className={styles.headCount}>
          {kind === "milestones"
            ? `${met} of ${goal.length} met`
            : `${stepsDone} of ${soloPlan?.plan.length ?? 0} done`}
        </span>
        <button
          type="button"
          className={task.stepsClose}
          onClick={() => setHidden(true)}
          aria-label="Hide progress"
          title="Hide progress"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className={styles.body}>
        {kind === "steps" ? (
          <>
            <div className={task.bar}>
              <i style={{ width: `${(stepsDone / (soloPlan?.plan.length || 1)) * 100}%` }} />
            </div>
            {soloPlan?.stale ? <p className={styles.note}>Not updated for a while</p> : null}
            {steps}
          </>
        ) : (
          <>
            {goal.length === 0 ? null : <Segments statuses={goalStatuses} />}
            {on ? null : (
              <p className={styles.note}>
                Milestones are off for this task, so nothing is checked against these.
              </p>
            )}
            <GoalList
              taskId={taskId}
              milestones={goal}
              owner={owner}
              editable={on}
              finished={finished}
            />
            {soloAgentId === undefined ? (
              <div className={styles.group}>
                <span className={styles.label}>Who's doing what</span>
                {parts.length === 0 ? (
                  <p className={styles.note}>Nothing handed out yet.</p>
                ) : (
                  <div className={styles.parts}>
                    {parts.map((part) => (
                      <Part
                        key={part.id}
                        taskId={taskId}
                        part={part}
                        milestones={all.filter((one) => one.delegationId === part.id)}
                        editable={on}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : steps === null ? null : (
              <div className={styles.group}>
                <span className={styles.label}>Steps</span>
                {steps}
              </div>
            )}
          </>
        )}
      </div>
      <ResizeHandle
        label="Resize progress"
        width={width}
        size={SIZE}
        edge="left"
        onResize={resize}
      />
    </aside>
  );
}
