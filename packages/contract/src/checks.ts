import { z } from "zod";
import { newAgentSchema } from "./agents.ts";

const itemTextShape = {
  // What to do, such as a command to run or a step in the app.
  check: z.string().trim().min(1),
  // What a pass looks like.
  expected: z.string().trim().min(1),
};

// The lead's or solo agent's, written when its work is done (D-73).
export const checklistItemSchema = z.object(itemTextShape);
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const taskChecklistSchema = z.object({
  items: z.array(checklistItemSchema).min(1),
  // How to install, run and test the work.
  setup: z.string(),
  // What was built or changed, and where.
  changes: z.string(),
  agentId: z.string().min(1),
  writtenAt: z.iso.datetime(),
});
export type TaskChecklist = z.infer<typeof taskChecklistSchema>;

// `id` is unique in its check; the user may edit, add or remove items before approving.
export const checkItemSchema = z.object({
  id: z.string().min(1),
  ...itemTextShape,
  from: z.enum(["lead", "checker", "user"]),
});
export type CheckItem = z.infer<typeof checkItemSchema>;

// A fail carries how to reproduce it and what happened instead.
export const checkResultSchema = z.object({
  id: z.string().min(1),
  outcome: z.enum(["pass", "fail", "not_run"]),
  evidence: z.string().min(1),
  steps: z.string().optional(),
  got: z.string().optional(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

// drafting: round 1's checker adds its cases. approving: the list waits in Needs you.
export const checkStatusSchema = z.enum([
  "drafting",
  "approving",
  "running",
  "done",
  "stopped",
  "failed",
]);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

// One round. From round 2 on, the items are round 1's approved list, unchanged.
export const checkRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  round: z.number().int().positive(),
  status: checkStatusSchema,
  checkerAgentId: z.string().min(1),
  checkerSessionId: z.string().min(1),
  // The agent whose work is checked: the lead or the solo agent.
  ownerAgentId: z.string().min(1),
  sandbox: z.enum(["worktree", "copy"]),
  items: z.array(checkItemSchema),
  results: z.array(checkResultSchema).optional(),
  // Findings outside the list; never fixed in the loop.
  notes: z.array(z.string()).optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type CheckRecord = z.infer<typeof checkRecordSchema>;

export const checkRequestSchema = z.object({
  reviewer: newAgentSchema,
  // Anything else the user wants checked.
  ask: z.string().trim().optional(),
  // Defaults to the task's lead or solo agent.
  agentId: z.string().min(1).optional(),
});
export type CheckRequest = z.infer<typeof checkRequestSchema>;
