import { z } from "zod";
import { roleSettingsSchema } from "./team.ts";

// A team or a chief written from the user's own words; nothing is saved until the user creates it.
export const draftPersonSchema = z.object({
  role: z.string().trim().min(1),
  purpose: z.string().trim(),
  instructions: z.string(),
  settings: roleSettingsSchema,
  // A member the department already has.
  agentId: z.string().min(1).optional(),
  // The user did not name its model.
  modelGuessed: z.boolean().optional(),
});
export type DraftPerson = z.infer<typeof draftPersonSchema>;

export const departmentDraftSchema = z.object({
  // Set when the draft changes a department that exists.
  departmentId: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  purpose: z.string().trim(),
  rules: z.string(),
  lead: draftPersonSchema,
  members: z.array(draftPersonSchema),
});
export type DepartmentDraft = z.infer<typeof departmentDraftSchema>;

export const chiefDraftSchema = z.object({
  name: z.string().trim().min(1),
  rules: z.string(),
  settings: roleSettingsSchema,
  modelGuessed: z.boolean().optional(),
});
export type ChiefDraft = z.infer<typeof chiefDraftSchema>;

// Asked only when the answer would change the draft.
export const draftQuestionSchema = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).max(4),
});
export type DraftQuestion = z.infer<typeof draftQuestionSchema>;

const draftRequestShape = {
  // What the user said, in order: the description, then answers and changes.
  notes: z.array(z.string().trim().min(1)).min(1),
  // The model that writes the draft.
  drafter: roleSettingsSchema,
};

const draftReplyShape = {
  questions: z.array(draftQuestionSchema),
  // Things the user may have missed, each a change they can ask for in one click.
  suggestions: z.array(z.string().trim().min(1)),
};

export const departmentDraftRequestSchema = z.object({
  ...draftRequestShape,
  current: z.array(departmentDraftSchema).optional(),
  // Its team is the starting draft when there is no current one.
  departmentId: z.string().min(1).optional(),
});
export type DepartmentDraftRequest = z.infer<typeof departmentDraftRequestSchema>;

export const departmentDraftReplySchema = z.object({
  ...draftReplyShape,
  departments: z.array(departmentDraftSchema),
});
export type DepartmentDraftReply = z.infer<typeof departmentDraftReplySchema>;

export const chiefDraftRequestSchema = z.object({
  ...draftRequestShape,
  current: chiefDraftSchema.optional(),
});
export type ChiefDraftRequest = z.infer<typeof chiefDraftRequestSchema>;

export const chiefDraftReplySchema = z.object({
  ...draftReplyShape,
  chief: chiefDraftSchema.optional(),
});
export type ChiefDraftReply = z.infer<typeof chiefDraftReplySchema>;
