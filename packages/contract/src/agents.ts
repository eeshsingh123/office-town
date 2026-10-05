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

// How an agent works, whichever harness it runs on.
export const agentSettingsSchema = z.object({
  harness: z.string().min(1),
  environment: environmentSpecSchema,
  model: harnessSettingSchema.optional(),
  effort: harnessSettingSchema.optional(),
  // Given to the agent with every brief.
  instructions: z.string().optional(),
  // Lowers the level the agent works at, never raises it.
  autonomy: autonomySchema.optional(),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

// An agent made from a profile follows it: a saved change applies to its next session. Its own
// settings are what it was made with, used if the profile is deleted.
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
  // Called in for a second opinion: not a member of any team, and gone once it answers.
  guest: z.literal(true).optional(),
  profileId: z.string().min(1).optional(),
  settings: agentSettingsSchema,
  createdAt: z.iso.datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const renameAgentRequestSchema = z.object({ name: agentNameSchema });
export type RenameAgentRequest = z.infer<typeof renameAgentRequestSchema>;

// A saved description of an agent, like a character creator.
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

// Who works on a new task: an agent made from a saved profile, or from settings chosen for it.
export const newAgentSchema = z.union([
  z.object({ profileId: z.string().min(1) }),
  z.object({ settings: agentSettingsSchema }),
]);
export type NewAgent = z.infer<typeof newAgentSchema>;
