import { z } from "zod";
import { adapterCapabilitiesSchema } from "./capabilities.ts";
import { sessionOptionsSchema } from "./options.ts";

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
  options: sessionOptionsSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime(),
  harnessSessionId: z.string().min(1).optional(),
  resumedFrom: z.string().min(1).optional(),
  endedAt: z.iso.datetime().optional(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

// `next` is set while more tasks may follow; it is passed back as the cursor for the next page.
export const taskPageSchema = z.object({
  tasks: z.array(taskRecordSchema),
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
  capabilities: adapterCapabilitiesSchema,
});
export type HarnessDescription = z.infer<typeof harnessDescriptionSchema>;

export const startTaskRequestSchema = z.object({
  prompt: z.string().min(1),
  options: sessionOptionsSchema,
});
export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;

export const resumeSessionRequestSchema = z.object({ prompt: z.string().min(1) });
export type ResumeSessionRequest = z.infer<typeof resumeSessionRequestSchema>;

export const taskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

// The stream starts after `after`, an event position; with none, it carries new events only.
// A reconnecting client sends its last position as the `Last-Event-ID` header instead.
export const eventStreamQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  session: z.string().min(1).optional(),
});
export type EventStreamQuery = z.input<typeof eventStreamQuerySchema>;

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
