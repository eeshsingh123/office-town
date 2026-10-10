import { z } from "zod";
import { agentSettingsSchema, newAgentSchema } from "./agents.ts";
import { autonomySchema } from "./autonomy.ts";
import { absolutePathSchema } from "./options.ts";

// Its level is its department's.
export const roleSettingsSchema = agentSettingsSchema.omit({ instructions: true, autonomy: true });
export type RoleSettings = z.infer<typeof roleSettingsSchema>;

// A kept member names its agent; a new one starts from a profile or its own settings.
export const teamRoleSchema = z
  .object({
    role: z.string().trim().min(1),
    purpose: z.string().trim(),
    agentId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
    settings: roleSettingsSchema.optional(),
  })
  .refine(
    (role) =>
      role.agentId !== undefined || role.profileId !== undefined || role.settings !== undefined,
    "A role needs a profile or settings of its own",
  );
export type TeamRole = z.infer<typeof teamRoleSchema>;

// The lead is fixed and never one of the roles.
export const teamSchema = z.object({
  name: z.string().trim().min(1),
  roles: z.array(teamRoleSchema),
});
export type Team = z.infer<typeof teamSchema>;

export const departmentRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  workspaceId: z.string().min(1),
  autonomy: autonomySchema,
  leadAgentId: z.string().min(1),
  // In a git workspace, each worker gets its own worktree and branch, which the lead merges.
  branchPerWorker: z.boolean(),
  // The lead commits, pushes and opens pull requests through the user's own git and gh logins.
  codeFlow: z.boolean(),
  // Every member reads these before each task.
  rules: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type DepartmentRecord = z.infer<typeof departmentRecordSchema>;

export const departmentSettingsSchema = departmentRecordSchema.pick({
  name: true,
  autonomy: true,
  branchPerWorker: true,
  codeFlow: true,
  rules: true,
});
export type DepartmentSettings = z.infer<typeof departmentSettingsSchema>;

export const newDepartmentRequestSchema = z.object({
  team: teamSchema,
  workspaceId: z.string().min(1),
  autonomy: autonomySchema,
  lead: newAgentSchema,
});
export type NewDepartmentRequest = z.infer<typeof newDepartmentRequestSchema>;

// A saved department, or a new lead who first proposes its team.
export const startTeamTaskRequestSchema = z.object({
  goal: z.string().min(1),
  team: z.union([
    z.object({ departmentId: z.string().min(1) }),
    z.object({ lead: newAgentSchema, workspaceId: z.string().min(1), autonomy: autonomySchema }),
  ]),
});
export type StartTeamTaskRequest = z.infer<typeof startTeamTaskRequestSchema>;

export const delegationRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  workerAgentId: z.string().min(1),
  workerSessionId: z.string().min(1),
  brief: z.string(),
  status: z.enum(["working", "done", "failed", "stopped", "interrupted"]),
  result: z.string().optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type DelegationRecord = z.infer<typeof delegationRecordSchema>;

export const continueTaskRequestSchema = z.object({ prompt: z.string().trim().optional() });
export type ContinueTaskRequest = z.infer<typeof continueTaskRequestSchema>;

// A fresh, isolated agent examining a copy of some of the task's files (D-18).
export const secondOpinionRequestSchema = z.object({
  brief: z.string().trim().min(1),
  // Relative to the examined agent's folder, which they must stay inside.
  paths: z.array(z.string().min(1)).min(1),
  reviewer: newAgentSchema,
  // Defaults to the task's lead or solo agent.
  agentId: z.string().min(1).optional(),
});
export type SecondOpinionRequest = z.infer<typeof secondOpinionRequestSchema>;

export const workspaceEntrySchema = z.object({ name: z.string().min(1), folder: z.boolean() });
export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;

export const proposalPlaceSchema = z.object({
  workspaceName: z.string().min(1),
  folders: z.array(absolutePathSchema).min(1),
  autonomy: autonomySchema,
});
export type ProposalPlace = z.infer<typeof proposalPlaceSchema>;
