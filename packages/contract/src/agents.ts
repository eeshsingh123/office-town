import { z } from "zod";
import { autonomySchema } from "./autonomy.ts";
import { environmentSpecSchema, harnessSettingSchema } from "./options.ts";

// Each keeps white text readable on top of it, in both themes.
export const agentColours = [
  { value: "#B5602B", label: "Clay" },
  { value: "#2F7565", label: "Green" },
  { value: "#6553AE", label: "Violet" },
  { value: "#3A6EA5", label: "Blue" },
  { value: "#A2456E", label: "Rose" },
  { value: "#5E7A2F", label: "Olive" },
  { value: "#8A5A2B", label: "Brown" },
  { value: "#4F5D75", label: "Slate" },
] as const;

export const agentColourSchema = z.enum(agentColours.map((colour) => colour.value));
export type AgentColour = z.infer<typeof agentColourSchema>;

// A handle such as "@kai-0427": unique, and what a lead names a worker by.
export const agentNameSchema = z
  .string()
  .regex(
    /^@[a-z0-9][a-z0-9-]{0,31}$/,
    'Must start with "@" and contain only lowercase letters, digits and hyphens',
  );

export const agentSettingsSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  model: harnessSettingSchema.optional(),
  effort: harnessSettingSchema.optional(),
  instructions: z.string().optional(),
  // Lowers the level the agent works at, never raises it.
  autonomy: autonomySchema.optional(),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

// Follows its profile from the next session; its own settings apply if the profile is deleted.
export const agentRecordSchema = z.object({
  id: z.string().min(1),
  name: agentNameSchema,
  colour: agentColourSchema,
  role: z.string().optional(),
  // What it does in its department, in a few words.
  purpose: z.string().optional(),
  departmentId: z.string().min(1).optional(),
  // The level it works at when it has no department, such as a solo agent's.
  autonomy: autonomySchema.optional(),
  // Not a member of any team, and gone once it answers.
  guest: z.literal(true).optional(),
  profileId: z.string().min(1).optional(),
  settings: agentSettingsSchema,
  createdAt: z.iso.datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

// `taskId` sends it to the agent in that goal, such as a follow-up; else to its latest.
export const agentMessageRequestSchema = z.object({
  text: z.string().trim().min(1),
  taskId: z.string().min(1).optional(),
});
export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;

export const renameAgentRequestSchema = z.object({ name: agentNameSchema });
export type RenameAgentRequest = z.infer<typeof renameAgentRequestSchema>;

export const profileRequestSchema = z.object({
  name: z.string().trim().min(1),
  // What agents made from it do, in a few words.
  role: z.string().trim(),
  colour: agentColourSchema,
  settings: agentSettingsSchema,
});
export type ProfileRequest = z.infer<typeof profileRequestSchema>;

export const profileRecordSchema = profileRequestSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type ProfileRecord = z.infer<typeof profileRecordSchema>;

export const newAgentSchema = z.union([
  z.object({ profileId: z.string().min(1) }),
  z.object({ settings: agentSettingsSchema }),
]);
export type NewAgent = z.infer<typeof newAgentSchema>;
