import { z } from "zod";
import { newAgentSchema } from "./agents.ts";
import { autonomySchema } from "./autonomy.ts";
import { adapterCapabilitiesSchema } from "./capabilities.ts";
import { usageLimitSchema, userRequestEventSchema } from "./events.ts";
import { absolutePathSchema, environmentSpecSchema, sessionOptionsSchema } from "./options.ts";

// idle: none of the others, such as a team cut off by a restart. queued: a chief's goal behind another.
export const taskStateSchema = z.enum(["queued", "working", "waiting", "idle", "ended"]);
export type TaskState = z.infer<typeof taskStateSchema>;

// Summed over the turns of a task's sessions on one harness.
export const taskUsageSchema = z.object({
  harness: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
});
export type TaskUsage = z.infer<typeof taskUsageSchema>;

export const taskRecordSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  createdAt: z.iso.datetime(),
  // Set on a team's task; `departmentId` once the team is approved.
  leadAgentId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  // Set on a piece of a chief's plan.
  parentTaskId: z.string().min(1).optional(),
  state: taskStateSchema,
  // Cleared when the finished goal is taken up again.
  reviewedAt: z.iso.datetime().optional(),
  // By harness.
  usage: z.array(taskUsageSchema),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const sessionStatusSchema = z.enum([
  "starting",
  "running",
  "stopped",
  "exited",
  "failed",
  "interrupted",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  options: sessionOptionsSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime(),
  harnessSessionId: z.string().min(1).optional(),
  resumedFrom: z.string().min(1).optional(),
  endedAt: z.iso.datetime().optional(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

// Newest first. `next` is passed back as `before` for the next page.
export const sessionPageSchema = z.object({
  sessions: z.array(sessionRecordSchema),
  next: z.string().min(1).optional(),
});
export type SessionPage = z.infer<typeof sessionPageSchema>;

export const sessionPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
export type SessionPageQuery = z.input<typeof sessionPageQuerySchema>;

// The latest any session reported; a limit belongs to the account.
export const harnessLimitsSchema = z.object({
  harness: z.string().min(1),
  limits: z.array(usageLimitSchema),
  reportedAt: z.iso.datetime(),
});
export type HarnessLimits = z.infer<typeof harnessLimitsSchema>;

export const taskSummarySchema = taskRecordSchema.extend({
  sessions: z.array(sessionRecordSchema),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

// `next` is passed back as the cursor for the next page.
export const taskPageSchema = z.object({
  tasks: z.array(taskSummarySchema),
  next: z.string().min(1).optional(),
});
export type TaskPage = z.infer<typeof taskPageSchema>;

export const taskDetailSchema = z.object({
  task: taskRecordSchema,
  sessions: z.array(sessionRecordSchema),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

export const storeSizeSchema = z.object({
  databaseBytes: z.number().int().nonnegative(),
  resultBytes: z.number().int().nonnegative(),
});
export type StoreSize = z.infer<typeof storeSizeSchema>;

export const harnessDescriptionSchema = z.object({
  harness: z.string().min(1),
  name: z.string().min(1),
  capabilities: adapterCapabilitiesSchema,
  // What still loads in an isolated session, when isolation is partial.
  isolationNote: z.string().optional(),
});
export type HarnessDescription = z.infer<typeof harnessDescriptionSchema>;

export const environmentListSchema = z.array(environmentSpecSchema);
export type EnvironmentList = z.infer<typeof environmentListSchema>;

// The first folder is where the agent works.
export const workspaceRequestSchema = z.object({
  name: z.string().trim().min(1),
  folders: z
    .array(absolutePathSchema)
    .min(1)
    .refine((folders) => new Set(folders).size === folders.length, "Each folder may appear once"),
});
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;

export const workspaceRecordSchema = workspaceRequestSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  usedAt: z.iso.datetime(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

// In floor pixels.
export const roomPositionSchema = z.object({
  x: z.number().int().min(0).max(20_000),
  y: z.number().int().min(0).max(20_000),
});
export type RoomPosition = z.infer<typeof roomPositionSchema>;

export const settingsSchema = z.object({
  // The last one chosen is kept.
  outputFolder: absolutePathSchema.optional(),
  chiefAgentId: z.string().min(1).optional(),
  // By department id, or "chief"; a room not listed is placed automatically.
  roomPositions: z.record(z.string(), roomPositionSchema).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

// No folders are passed: an agent works in a saved workspace or a new folder in the output folder.
export const startTaskRequestSchema = z
  .object({
    prompt: z.string().min(1),
    agent: newAgentSchema,
    autonomy: autonomySchema,
    workspaceId: z.string().min(1).optional(),
    outputFolder: absolutePathSchema.optional(),
  })
  .refine(
    (request) => request.workspaceId === undefined || request.outputFolder === undefined,
    "Give a workspace or an output folder, not both",
  );
export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;

export const resumeSessionRequestSchema = z.object({ prompt: z.string().min(1) });
export type ResumeSessionRequest = z.infer<typeof resumeSessionRequestSchema>;

// `active=true` lists every running task on one page; a resumed old task can be far down the list.
export const taskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  active: z.stringbool().default(false),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

// With no `after` or `Last-Event-ID`, only new events. `follow=false` replays from 0 and ends.
export const eventStreamQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  session: z.string().min(1).optional(),
  follow: z.stringbool().default(true),
});
export type EventStreamQuery = z.input<typeof eventStreamQuerySchema>;

export const pendingRequestSchema = z.object({
  position: z.number().int().positive(),
  taskId: z.string().min(1),
  event: userRequestEventSchema,
});
export type PendingRequest = z.infer<typeof pendingRequestSchema>;

// Oldest first. A stream opened from `position` misses and repeats nothing.
export const pendingRequestListSchema = z.object({
  requests: z.array(pendingRequestSchema),
  position: z.number().int().nonnegative(),
});
export type PendingRequestList = z.infer<typeof pendingRequestListSchema>;

export const apiErrorSchema = z.object({
  error: z.enum([
    "invalid_request",
    "unauthorized",
    "not_found",
    "conflict",
    "too_large",
    "harness_failed",
    "internal",
  ]),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const coreReadySchema = z.object({ url: z.url(), token: z.string().min(1) });
export type CoreReady = z.infer<typeof coreReadySchema>;
