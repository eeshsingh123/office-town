import {
  type DelegationRecord,
  type MilestoneRecord,
  SEND_BACK_LIMIT,
  type TaskRecord,
} from "@office-town/contract";
import { isChiefTask } from "../chief/chief.ts";
import type { Store } from "../store/store.ts";
import type { Caller } from "../tools/tools.ts";

// Past this many on one goal, an agent is asked to merge or move detail into the parts (owner).
export const MILESTONES_NUDGE = 12;

export const milestonesOn = (store: Store, taskId: string) =>
  store.getTask(taskId)?.milestones === true;

// A chief's goal takes its departments' pieces along, as Efficient mode does (D-94).
export function setMilestonesOn(store: Store, taskId: string, on: boolean): TaskRecord {
  for (const { pieceTaskId } of store.listPieces(taskId)) {
    if (pieceTaskId !== undefined) store.setTaskMilestones(pieceTaskId, on);
  }
  return store.setTaskMilestones(taskId, on);
}

// The goal's own, outside any part. A chief's goal holds only its pieces' until they start.
export function goalMilestones(store: Store, taskId: string): MilestoneRecord[] {
  if (isChiefTask(store, taskId)) return [];
  return store.listMilestones(taskId).filter((milestone) => milestone.delegationId === undefined);
}

export const partMilestones = (store: Store, delegation: DelegationRecord) =>
  store.listMilestones(delegation.taskId).filter((one) => one.delegationId === delegation.id);

export const sendBackLimit = (delegation: DelegationRecord) =>
  delegation.sendBackLimit ?? SEND_BACK_LIMIT;

// A lead or a solo agent: whoever owns the goal's own milestones.
export function ownsGoal(store: Store, caller: Caller): boolean {
  const task = store.getTask(caller.taskId);
  if (task === undefined || isChiefTask(store, caller.taskId)) return false;
  if (task.leadAgentId !== undefined) return task.leadAgentId === caller.agentId;
  return store.getAgent(caller.agentId)?.guest !== true;
}

// A worker on a lead's team.
export function isWorker(store: Store, caller: Caller): boolean {
  const task = store.getTask(caller.taskId);
  if (task?.leadAgentId === undefined || task.leadAgentId === caller.agentId) return false;
  return store.getAgent(caller.agentId)?.guest !== true;
}

// As agents read them: the key, the outcome, and how the user will see it.
export function milestoneLines(milestones: readonly MilestoneRecord[]): string {
  return milestones
    .map((milestone) => {
      const see = milestone.see === "" ? "" : `\n  How the user will see it: ${milestone.see}`;
      return `- ${milestone.key}. ${milestone.outcome}${see}`;
    })
    .join("\n");
}

const count = (milestones: readonly MilestoneRecord[], status: MilestoneRecord["status"]) =>
  milestones.filter((milestone) => milestone.status === status).length;

const keys = (milestones: readonly MilestoneRecord[]) =>
  milestones.map((milestone) => milestone.key).join(", ");

// Written by the core at no cost, beside each result the lead reads.
export function resultLine(
  store: Store,
  delegation: DelegationRecord,
  workerName: string,
): string | undefined {
  if (!milestonesOn(store, delegation.taskId)) return undefined;
  const goal = goalMilestones(store, delegation.taskId);
  const part = partMilestones(store, delegation);
  const lines = [`Goal: ${count(goal, "met")} of ${goal.length} milestones met.`];
  const name = delegation.title === undefined ? `${workerName}'s part` : `"${delegation.title}"`;
  if (part.length === 0) {
    lines.push(`${name} had no milestones.`);
  } else if (delegation.accepted !== undefined) {
    lines.push(`${name}: all ${part.length} milestones met, so it is done. You need not check it.`);
  } else {
    const notMet = part.filter((one) => one.status === "not_met");
    const unreported = part.filter((one) => one.status === "not_started");
    lines.push(
      [
        `${name}: ${count(part, "met")} of ${part.length} milestones met`,
        notMet.length === 0 ? "" : `; not met: ${keys(notMet)}`,
        unreported.length === 0 ? "" : `; not reported: ${keys(unreported)}`,
        ".",
      ].join(""),
    );
  }
  const sent = delegation.sendBacks?.length ?? 0;
  if (sent > 0) lines.push(`Sent back ${sent} of ${sendBackLimit(delegation)} times.`);
  return `Milestones: ${lines.join(" ")}`;
}

// Every milestone of a part met: it is done at once, with a notice for the user (owner).
export function acceptIfMet(store: Store, delegation: DelegationRecord): DelegationRecord {
  if (!milestonesOn(store, delegation.taskId)) return delegation;
  const part = partMilestones(store, delegation);
  if (part.length === 0 || part.some((milestone) => milestone.status !== "met")) return delegation;
  return store.setDelegationAccepted(delegation.id, "new");
}

// What a lead's brief carries: nothing with Milestones off, so the brief reads as before.
export const briefMilestones = (store: Store, taskId: string) =>
  milestonesOn(store, taskId) ? goalMilestones(store, taskId) : undefined;

function statusLines(milestones: readonly MilestoneRecord[]): string {
  return milestones
    .map((milestone) => {
      const status =
        milestone.status === "met"
          ? "met"
          : milestone.status === "not_met"
            ? "not met"
            : "not reported yet";
      const proof = milestone.proof === undefined ? "" : ` (${milestone.proof})`;
      return `- ${milestone.key} ${status}: ${milestone.outcome}${proof}`;
    })
    .join("\n");
}

// Written by the core from the record, so a new session never takes the agent's word for it.
export function handoverProgress(store: Store, caller: Caller): string | undefined {
  if (!milestonesOn(store, caller.taskId)) return undefined;
  if (isWorker(store, caller)) {
    const part = store.workingDelegation(caller.sessionId);
    if (part === undefined) return undefined;
    const sent = part.sendBacks?.length ?? 0;
    const back = sent === 0 ? "" : `\nSent back ${sent} of ${sendBackLimit(part)} times.`;
    return `Your part's milestones:\n${statusLines(partMilestones(store, part))}${back}`;
  }
  if (!ownsGoal(store, caller)) return undefined;
  const parts = store.listDelegations(caller.taskId).flatMap((part) => {
    const own = partMilestones(store, part);
    if (own.length === 0) return [];
    const name = store.getAgent(part.workerAgentId)?.name ?? "A worker";
    const met = own.filter((one) => one.status === "met").length;
    return [
      `- ${name}${part.title === undefined ? "" : ` "${part.title}"`}: ${part.status}, ${met} of ${own.length} met`,
    ];
  });
  const goal = `The goal's milestones:\n${statusLines(goalMilestones(store, caller.taskId))}`;
  return parts.length === 0 ? goal : `${goal}\n\nParts:\n${parts.join("\n")}`;
}
