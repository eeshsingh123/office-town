import { z } from "zod";
import { newAgentSchema } from "./agents.ts";
import { adapterCapabilitiesSchema } from "./capabilities.ts";
import { userRequestEventSchema } from "./events.ts";
import {
  absolutePathSchema,
  environmentSpecSchema,
  permissionModeSchema,
  sessionOptionsSchema,
} from "./options.ts";

export const taskRecordSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  createdAt: z.iso.datetime(),
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

export const taskSummarySchema = taskRecordSchema.extend({
  sessions: z.array(sessionRecordSchema),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

// `next` is set while more tasks may follow; it is passed back as the cursor for the next page.
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
  // The harness's name as people know it.
  name: z.string().min(1),
  capabilities: adapterCapabilitiesSchema,
});
export type HarnessDescription = z.infer<typeof harnessDescriptionSchema>;

// Where a harness can run on this machine: natively, and in each installed WSL distro.
export const environmentListSchema = z.array(environmentSpecSchema);
export type EnvironmentList = z.infer<typeof environmentListSchema>;

// The first folder is where the agent works; it may use the others as freely.
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

export const settingsSchema = z.object({
  // Where a task with no workspace gets a folder of its own; the last one chosen is kept.
  outputFolder: absolutePathSchema.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

// A new agent works in a saved workspace, or else in a new folder for this task inside the output
// folder: the one given, or the last one given. Folders are never passed directly, and a resume
// goes through its own request, which checks the conversation is not already running.
export const startTaskRequestSchema = z
  .object({
    prompt: z.string().min(1),
    agent: newAgentSchema,
    permissionMode: permissionModeSchema,
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

// `active=true` lists every task with an agent starting or running instead, on one page: those
// can be far down the list when an old task was resumed.
export const taskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  active: z.stringbool().default(false),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

// The stream starts after `after`, an event position; with none, it carries new events only.
// A reconnecting client sends its last position as the `Last-Event-ID` header instead.
// `follow=false` makes it a replay that ends once it has caught up, starting from 0 by default.
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

// Oldest first. `position` is where the store stood when the list was read: a stream opened after
// it carries every later request and answer, with nothing missed or repeated.
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

// The one line the core prints on stdout once it accepts requests.
export const coreReadySchema = z.object({ url: z.url(), token: z.string().min(1) });
export type CoreReady = z.infer<typeof coreReadySchema>;
