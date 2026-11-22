import { z } from "zod";

// One rule for core and app: a worker's open turn this long without news reads as quiet (D-120).
export const QUIET_AFTER_MS = 30 * 60_000;

export const noticeKindSchema = z.enum([
  "needs-you",
  "finished",
  "failed",
  "lead-stopped",
  // Cut off by a close or a crash.
  "work-stopped",
  "usage-paused",
  // An automation paused itself, or runs were missed while Office Town was closed.
  "automation",
]);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

// For a kind the user never set. A finished task is often watched, so it stays quiet unless asked.
export const NOTICE_DEFAULTS: Record<NoticeKind, boolean> = {
  "needs-you": true,
  finished: false,
  failed: true,
  "lead-stopped": true,
  "work-stopped": true,
  "usage-paused": true,
  automation: true,
};

// What the core decided deserves an alert. It names agents, teams and tasks, never an agent's own
// text (D-124).
export const noticeSchema = z.object({
  id: z.string().min(1),
  kind: noticeKindSchema,
  taskId: z.string().min(1).optional(),
  title: z.string().min(1),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Notice = z.infer<typeof noticeSchema>;

// A kind left out keeps its default.
export const notificationsSchema = z.partialRecord(noticeKindSchema, z.boolean());
export type Notifications = z.infer<typeof notificationsSchema>;

// A start no person typed (D-121): a resume, or an automation's run (D-125).
export const queuedStartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resume"), taskId: z.string().min(1) }),
  z.object({ kind: z.literal("run"), runId: z.string().min(1) }),
]);
export type QueuedStart = z.infer<typeof queuedStartSchema>;

export const queueEntrySchema = z.object({
  id: z.string().min(1),
  what: queuedStartSchema,
  // Not set on a run whose task is not made yet.
  taskId: z.string().min(1).optional(),
  enqueuedAt: z.iso.datetime(),
  waitUntil: z.iso.datetime(),
  state: z.enum(["waiting", "started", "skipped", "cancelled"]),
  // Why it waits, or why it was skipped or cancelled, in plain words.
  reason: z.string().min(1).optional(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

// A task a close or crash cut off, for Home's card (D-122). A chief's goal is one row with its parts.
export const stoppedTaskSchema = z.object({
  taskId: z.string().min(1),
  partIds: z.array(z.string().min(1)),
  // Set when it cannot be resumed, such as a folder that is gone.
  reason: z.string().min(1).optional(),
  // Its resume in this launch, once asked for.
  entry: queueEntrySchema.optional(),
});
export type StoppedTask = z.infer<typeof stoppedTaskSchema>;

export const stoppedTasksSchema = z.object({ tasks: z.array(stoppedTaskSchema) });
export type StoppedTasks = z.infer<typeof stoppedTasksSchema>;

export const resumeTasksRequestSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(100),
});
export type ResumeTasksRequest = z.infer<typeof resumeTasksRequestSchema>;

// Whether the shell should keep the computer from sleeping (D-123).
export const keepAwakeSchema = z.object({ awake: z.boolean() });
export type KeepAwake = z.infer<typeof keepAwakeSchema>;
