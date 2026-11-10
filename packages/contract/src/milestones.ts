import { z } from "zod";

// "Being worked on" is shown, not stored: a part's milestones while its part is at work.
export const milestoneStatusSchema = z.enum(["not_started", "met", "not_met"]);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

// The words the user reads: one outcome, and how they would see it for themselves.
export const milestoneTextSchema = z.object({
  outcome: z.string().trim().min(1),
  see: z.string().trim(),
});
export type MilestoneText = z.infer<typeof milestoneTextSchema>;

// A change the user made, on its way to the agent that owns the list (D-77, D-83).
export const milestoneDeliverySchema = z.object({
  agentId: z.string().min(1),
  state: z.enum(["telling", "taken"]),
});
export type MilestoneDelivery = z.infer<typeof milestoneDeliverySchema>;

// Without a delegation, it is one of its task's goal milestones. A chief's piece names its
// milestones until the piece starts; then they are its department task's goal milestones.
export const milestoneRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  // What agents call it, such as "M3": unique in its task.
  key: z.string().min(1),
  delegationId: z.string().min(1).optional(),
  pieceId: z.string().min(1).optional(),
  ...milestoneTextSchema.shape,
  status: milestoneStatusSchema,
  // What the agent that reported it did and saw.
  proof: z.string().optional(),
  reportedBy: z.string().min(1).optional(),
  origin: z.enum(["agent", "user"]),
  // An agent's id, or "user", for the last change after it was written.
  changedBy: z.string().min(1).optional(),
  delivery: milestoneDeliverySchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MilestoneRecord = z.infer<typeof milestoneRecordSchema>;

// The user's own: on the goal, or on one part.
export const newMilestoneRequestSchema = milestoneTextSchema.extend({
  delegationId: z.string().min(1).optional(),
});
export type NewMilestoneRequest = z.infer<typeof newMilestoneRequestSchema>;

export const milestoneEditRequestSchema = milestoneTextSchema;
export type MilestoneEditRequest = z.infer<typeof milestoneEditRequestSchema>;

// Steps are the agent's own list, kept in its AI app, so the user asks for a change.
export const stepRequestSchema = z.object({
  agentId: z.string().min(1),
  change: z.enum(["add", "remove"]),
  step: z.string().trim().min(1),
});
export type StepRequest = z.infer<typeof stepRequestSchema>;

// A lead may send a part back this many times; the user may allow more (owner).
export const SEND_BACK_LIMIT = 2;

export const sendBackSchema = z.object({
  note: z.string().min(1),
  // Milestone keys that were not met.
  milestones: z.array(z.string().min(1)).min(1),
  // What the worker reported for them before it was sent back.
  proofs: z.array(z.string()),
  at: z.iso.datetime(),
});
export type SendBack = z.infer<typeof sendBackSchema>;
