import type { DelegationRecord, MilestoneRecord, PlanPiece } from "@office-town/contract";

// Shown, never stored: a part's milestone while the part is at work, or one its owner left
// without a word once it finished (D-95).
export type ShownStatus = "met" | "notMet" | "doing" | "todo" | "unreported";

export function shownStatus(
  milestone: MilestoneRecord,
  working: boolean,
  finished: boolean,
): ShownStatus {
  if (milestone.status === "met") return "met";
  if (milestone.status === "not_met") return "notMet";
  if (working) return "doing";
  return finished ? "unreported" : "todo";
}

export const metCount = (statuses: readonly ShownStatus[]) =>
  statuses.filter((status) => status === "met").length;

export const fraction = (statuses: readonly ShownStatus[]) =>
  `${metCount(statuses)} of ${statuses.length}`;

export function goalStatuses(
  milestones: Record<string, MilestoneRecord>,
  taskId: string,
  ended: boolean,
): ShownStatus[] {
  return Object.values(milestones)
    .filter((one) => one.taskId === taskId && one.delegationId === undefined)
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)))
    .map((one) => shownStatus(one, false, ended));
}

// The agent's part at work, or else its last one in the task.
export function partStatuses(
  milestones: Record<string, MilestoneRecord>,
  delegations: Record<string, DelegationRecord>,
  taskId: string,
  agentId: string,
): ShownStatus[] {
  const part = Object.values(delegations)
    .filter((one) => one.taskId === taskId && one.workerAgentId === agentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (part === undefined) return [];
  const working = part.status === "working";
  return Object.values(milestones)
    .filter((one) => one.delegationId === part.id)
    .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)))
    .map((one) => shownStatus(one, working, !working));
}

// A chief's goal counts its departments' pieces.
export function pieceStatuses(pieces: readonly PlanPiece[]): ShownStatus[] {
  return pieces
    .filter((piece) => piece.status !== "dropped")
    .map((piece) =>
      piece.status === "done"
        ? "met"
        : piece.status === "working"
          ? "doing"
          : piece.status === "failed" || piece.status === "stopped"
            ? "notMet"
            : "todo",
    );
}
