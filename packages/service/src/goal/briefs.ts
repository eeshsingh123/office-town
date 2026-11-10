import type { MilestoneRecord } from "@office-town/contract";
import { milestoneLines } from "./record.ts";

// The words the user reads, so nothing technical goes in them: proof goes in the report.
const PLAIN =
  "in plain words the user would use, each one outcome they can see for themselves, with nothing technical in it";

// Read by a lead with Milestones on, before it hands anything out.
export function leadMilestones(existing: readonly MilestoneRecord[]): string {
  const first =
    existing.length === 0
      ? `Milestones are on for this goal. Your first step is set_milestones: write what the user will get, ${PLAIN}. Write at least one, even for a small goal.`
      : `Milestones are on for this goal. The user approved these as the goal's milestones:\n${milestoneLines(existing)}\nAdd to them with set_milestones only if something the goal needs is missing.`;
  return `${first} The user can change them at any time, and you are told each change. When you hand out a part with delegate, give it a short title and the milestones of that part. Once the work is put together, report each of the goal's milestones with report_milestone before your final message.`;
}

// Takes the place of the line on checking with no rounds of fixing (D-73, D-95).
export const LEAD_CHECKS =
  "Each worker checks its own piece: it builds, its own tests pass, and it reports each of its milestones. You check that the merged work builds and its tests pass. When a result has milestones not met, fix it yourself if it is small, or send the part back with send_back, naming only those milestones. A part goes back at most twice; after that the user decides. A part with every milestone met is done: do not check it again. The end-to-end check comes after, outside the team.";

export const SOLO_MILESTONES = `Milestones are on for this task. Your first step is set_milestones: write what the user will get, ${PLAIN}. Write at least one, even for a small task. The user can change them at any time, and you are told each change. Before your final message, report each one with report_milestone.`;

export const CHIEF_MILESTONES = `Milestones are on for this goal. Give each piece in propose_plan its milestones: what that department's part gives the user, ${PLAIN}. The user edits them on the plan card.`;

// Goes with the part, so it reaches the worker however the brief is sent.
export function partBrief(work: string, milestones: readonly MilestoneRecord[]): string {
  if (milestones.length === 0) return work;
  return `${work}

Your part's milestones, which the user can see:
${milestoneLines(milestones)}
Before your final message, report each one with report_milestone: met or not, with what you did and saw.`;
}
