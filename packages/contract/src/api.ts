import { z } from "zod";
import { newAgentSchema, userProfileSchema } from "./agents.ts";
import { attachmentIdsSchema } from "./attachments.ts";
import { autonomySchema } from "./autonomy.ts";
import { adapterCapabilitiesSchema } from "./capabilities.ts";
import { userRequestEventSchema } from "./events.ts";
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

// Its agents were stopped once an account passed 95% of a usage window, until the user resumes them.
export const taskPauseSchema = z.object({
  accountId: z.string().min(1),
  // The window's own name, such as "5-hour".
  window: z.string().min(1),
  usedFraction: z.number().nonnegative(),
  resetsAt: z.iso.datetime().optional(),
  // When the user chose to resume it at the reset.
  resumeAt: z.iso.datetime().optional(),
});
export type TaskPause = z.infer<typeof taskPauseSchema>;

export const resumePausedRequestSchema = z.object({ at: z.iso.datetime().optional() });
export type ResumePausedRequest = z.infer<typeof resumePausedRequestSchema>;

export const taskRecordSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  createdAt: z.iso.datetime(),
  // Set on a team's task; `departmentId` once the team is approved.
  leadAgentId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  // Set on a group task: the agents picked to work under its lead.
  workerAgentIds: z.array(z.string().min(1)).optional(),
  // Set on a piece of a chief's plan.
  parentTaskId: z.string().min(1).optional(),
  // Where its agents work; a chief's goal has none.
  workspaceId: z.string().min(1).optional(),
  state: taskStateSchema,
  // Cleared when the finished goal is taken up again.
  reviewedAt: z.iso.datetime().optional(),
  paused: taskPauseSchema.optional(),
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

// Whether a harness can run on this computer, for setup. Native only.
export const harnessStatusSchema = z.object({
  harness: z.string().min(1),
  installed: z.boolean(),
  // Unset when the harness needs no sign-in to run, or cannot say.
  signedIn: z.boolean().optional(),
  // The vendor's own install command for this computer, and its page.
  installCommand: z.string().optional(),
  installPage: z.string().optional(),
});
export type HarnessStatus = z.infer<typeof harnessStatusSchema>;

export const environmentListSchema = z.array(environmentSpecSchema);
export type EnvironmentList = z.infer<typeof environmentListSchema>;

// Folders: the user's own, used as they are. Scratch: each task gets a new folder inside the first.
export const workspaceKindSchema = z.enum(["folders", "scratch"]);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export const folderAccessSchema = z.enum(["edit", "read"]);
export type FolderAccess = z.infer<typeof folderAccessSchema>;

export const workspaceFolderSchema = z.object({
  path: absolutePathSchema,
  access: folderAccessSchema,
});
export type WorkspaceFolder = z.infer<typeof workspaceFolderSchema>;

// The first folder is where agents start, so they must be able to edit it.
export const workspaceRequestSchema = z.object({
  name: z.string().trim().min(1),
  kind: workspaceKindSchema,
  folders: z
    .array(workspaceFolderSchema)
    .min(1)
    .refine(
      (folders) => new Set(folders.map((folder) => folder.path)).size === folders.length,
      "Each folder may appear once",
    )
    .refine(
      (folders) => folders[0]?.access === "edit",
      "Agents must be able to edit the first folder",
    ),
});
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;

export const workspaceRecordSchema = workspaceRequestSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  usedAt: z.iso.datetime(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

// What uses a workspace now, read fresh on each request.
export const workspaceUsageSchema = z.object({
  workspaceId: z.string().min(1),
  departmentIds: z.array(z.string().min(1)),
  taskCount: z.number().int().nonnegative(),
  // Newest first, at most five.
  recentTasks: z.array(taskRecordSchema),
  // A Scratch workspace's first folder is made when a task needs it, so it is never listed.
  missingFolders: z.array(absolutePathSchema),
  // Of the first folder, when it is a git repository.
  branch: z.string().min(1).optional(),
  // Workers' own copies of the repository in its unfinished tasks.
  worktrees: z.array(
    z.object({
      agentId: z.string().min(1),
      taskId: z.string().min(1),
      branch: z.string().min(1).optional(),
    }),
  ),
});
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;

// In floor pixels.
export const roomPositionSchema = z.object({
  x: z.number().int().min(0).max(20_000),
  y: z.number().int().min(0).max(20_000),
});
export type RoomPosition = z.infer<typeof roomPositionSchema>;

export const onboardingSchema = z.object({
  setupDone: z.boolean().optional(),
  purpose: z.enum(["software", "business", "exploring"]).optional(),
  // Ids of the tutorials the user finished; kept, never shown.
  tutorialsDone: z.array(z.string().min(1)).optional(),
  // The date of the newest What's new entry the user has seen, as YYYY-MM-DD.
  whatsNewSeen: z.string().optional(),
  checklistHidden: z.boolean().optional(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

export const displaySchema = z.object({
  // Percent of the normal size.
  textSize: z.union([z.literal(100), z.literal(115), z.literal(130)]).optional(),
  moreContrast: z.boolean().optional(),
  lessMotion: z.boolean().optional(),
  // A screen reader reads out each new request.
  announceRequests: z.boolean().optional(),
});
export type Display = z.infer<typeof displaySchema>;

export const settingsSchema = z.object({
  chiefAgentId: z.string().min(1).optional(),
  you: userProfileSchema.optional(),
  // By department id, or "chief"; a room not listed is placed automatically.
  roomPositions: z.record(z.string(), roomPositionSchema).optional(),
  onboarding: onboardingSchema.optional(),
  display: displaySchema.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

// No folders are passed: an agent works in a saved workspace.
export const startTaskRequestSchema = z.object({
  prompt: z.string().min(1),
  agent: newAgentSchema,
  autonomy: autonomySchema,
  workspaceId: z.string().min(1),
  attachments: attachmentIdsSchema.optional(),
});
export type StartTaskRequest = z.infer<typeof startTaskRequestSchema>;

export const resumeSessionRequestSchema = z.object({
  prompt: z.string().min(1),
  attachments: attachmentIdsSchema.optional(),
});
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

// Approve all or Reject all in Needs you (D-57): approvals only, each answered with its "once"
// option. A request already answered, or whose agent has ended, is skipped.
export const answerPermissionsRequestSchema = z.object({
  decision: z.enum(["allow", "reject"]),
  requests: z
    .array(z.object({ sessionId: z.string().min(1), requestId: z.string().min(1) }))
    .min(1)
    .max(1000),
});
export type AnswerPermissionsRequest = z.infer<typeof answerPermissionsRequestSchema>;

export const answerPermissionsResultSchema = z.object({
  answered: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type AnswerPermissionsResult = z.infer<typeof answerPermissionsResultSchema>;

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
