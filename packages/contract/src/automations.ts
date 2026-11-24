import { z } from "zod";
import { startTaskRequestSchema } from "./api.ts";
import { attachmentSchema } from "./attachments.ts";
import { deliverySchema } from "./destinations.ts";
import { chiefTaskRequestSchema } from "./plans.ts";
import { startTeamTaskRequestSchema } from "./team.ts";

// Fill-ins written in a prompt, filled in when each run starts (D-125).
export const FILL_INS = {
  date: "{date}",
  lastResult: "{last result}",
  event: "{event}",
} as const;

// Chains past this many runs in a row stop (D-125).
export const CHAIN_DEPTH = 5;
export const RUNS_KEPT = 500;
// The most an automation's notes hold; the core refuses more (D-133).
export const NOTES_CHARS = 8_000;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time such as 09:00");
const dateSchema = z.iso.date();

// Each preset keeps only its own details; the core turns it into a cron rule. Shortest repeat: 1 hour.
export const scheduleSchema = z.discriminatedUnion("repeat", [
  z.object({ repeat: z.literal("daily"), time: timeSchema }),
  z.object({ repeat: z.literal("weekdays"), time: timeSchema }),
  z.object({
    repeat: z.literal("weekly"),
    // 0 is Sunday.
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: timeSchema,
  }),
  z.object({
    repeat: z.literal("monthly"),
    day: z.union([z.number().int().min(1).max(28), z.literal("last")]),
    time: timeSchema,
  }),
  z.object({
    repeat: z.literal("hours"),
    every: z.number().int().min(1).max(12),
    // The first run of each day; runs go on until `until`, else to the day's end.
    from: timeSchema,
    until: timeSchema.optional(),
  }),
  // A wall-clock date and time in the schedule's zone.
  z.object({ repeat: z.literal("once"), date: dateSchema, time: timeSchema }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleEndSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("never") }),
  z.object({ kind: z.literal("on"), date: dateSchema }),
  z.object({ kind: z.literal("after"), runs: z.number().int().min(1).max(1000) }),
]);
export type ScheduleEnd = z.infer<typeof scheduleEndSchema>;

// Shortest gap between two agent checks, and the one a new check starts with (D-128).
export const CHECK_MINUTES = { least: 15, first: 60 } as const;
// What one run gets at most; the rest wait for the next run (D-128).
export const EVENTS_A_RUN = 50;

// What starts a run from outside (D-128). Each kind is one source file in the core.
export const eventSourceSchema = z.discriminatedUnion("kind", [
  // A file lands in a folder. Files the automation's own agents wrote never count.
  z.object({
    kind: z.literal("folder"),
    path: z.string().trim().min(1),
    subfolders: z.boolean().default(true),
  }),
  // A short agent turn looks, through its apps, and says what is new.
  z.object({
    kind: z.literal("check"),
    look: z.string().trim().min(1).max(2_000),
    everyMinutes: z
      .number()
      .int()
      .min(CHECK_MINUTES.least)
      .max(24 * 60)
      .default(CHECK_MINUTES.first),
  }),
  // New issues or pull requests, read with the GitHub app's own key.
  z.object({
    kind: z.literal("github"),
    connectorId: z.string().min(1),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "A repository such as owner/name"),
    watch: z.enum(["issues", "pulls", "both"]),
  }),
  // New posts in an RSS or Atom feed.
  z.object({ kind: z.literal("feed"), url: z.url({ protocol: /^https?$/ }) }),
]);
export type EventSourceConfig = z.infer<typeof eventSourceSchema>;
export type EventSourceKind = EventSourceConfig["kind"];

// Run now is an action, not a trigger. A chain is set only on the later automation (D-125).
export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("schedule"),
    schedule: scheduleSchema,
    // IANA, such as "Europe/Berlin"; times show in the computer's own zone.
    timeZone: z.string().min(1),
    starts: dateSchema.optional(),
    ends: scheduleEndSchema.default({ kind: "never" }),
  }),
  z.object({
    kind: z.literal("after"),
    automationId: z.string().min(1),
    // "done": only when its run finished well; "any": however it ended.
    outcome: z.enum(["done", "any"]),
  }),
  z.object({ kind: z.literal("event"), source: eventSourceSchema }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

// The New task it starts: a saved department (never one proposed anew), an assistant or the chief.
export const automationTaskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assistant"), request: startTaskRequestSchema }),
  z.object({
    kind: z.literal("department"),
    request: startTeamTaskRequestSchema.extend({
      team: z.object({
        departmentId: z.string().min(1),
        workspaceId: z.string().min(1).optional(),
      }),
    }),
  }),
  z.object({ kind: z.literal("chief"), request: chiefTaskRequestSchema }),
]);
export type AutomationTask = z.infer<typeof automationTaskSchema>;

// "ask": decisions wait in Needs you, as for any task. "auto": the run decides on its own, end to
// end (D-126). Permission asks follow the level either way.
export const decisionsSchema = z.enum(["ask", "auto"]);
export type Decisions = z.infer<typeof decisionsSchema>;

export const automationRulesSchema = z.object({
  decisions: decisionsSchema.default("ask"),
  // A run waits this long for a busy team, then is skipped.
  waitHours: z.number().int().min(1).max(12).default(2),
  // A run missed while Office Town was closed still runs if it is this recent; 0 never catches up.
  catchUpHours: z.number().int().min(0).max(48).default(12),
  // A run waiting on the user this long ends; null waits without limit (D-118).
  answerWithinHours: z.number().int().min(1).max(168).nullable().default(24),
  // Skip the run when its account is past this share of a window, where the provider shares limits.
  skipAbove: z.union([z.literal(0.7), z.literal(0.9)]).optional(),
  // Off: a finished run is Done, with no review.
  review: z.boolean().default(false),
  // Its result goes to the workspace's Library.
  saveResult: z.boolean().default(false),
  // Apps, by `appKeyOf`, whose changes go through without asking in its runs and checks, where
  // the app is on Ask me first. Read only still refuses; reads never ask (D-129).
  appsWithoutAsking: z.array(z.string().min(1)).max(100).optional(),
  // Destinations its results and alerts go to (D-130). Neither the drafter nor
  // `propose_schedule` sets it.
  sendTo: z.array(z.string().min(1)).max(10).optional(),
});
export type AutomationRules = z.infer<typeof automationRulesSchema>;

export const automationRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  task: automationTaskSchema,
  trigger: triggerSchema,
  rules: automationRulesSchema,
});
export type AutomationRequest = z.input<typeof automationRequestSchema>;
export type AutomationFields = z.output<typeof automationRequestSchema>;

// What waits on the user, with the one button that fixes it.
export const automationPauseSchema = z.object({
  reason: z.string().min(1),
  fix: z.enum(["edit", "turn-on", "sign-in"]),
});
export type AutomationPause = z.infer<typeof automationPauseSchema>;

// Before its task exists a run is waiting or skipped; once it has one, the task's own status.
export const runStatusSchema = z.enum([
  "waiting",
  "skipped",
  "working",
  "queued",
  "needs",
  "review",
  "done",
  "failed",
  "stopped",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const automationRunSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  number: z.number().int().positive(),
  // The slot it was due for: with the automation, its key, so it never fires twice (D-125).
  scheduledFor: z.iso.datetime(),
  by: z.enum(["schedule", "now", "chain", "event"]),
  status: runStatusSchema,
  // One plain sentence, only when something was not ordinary.
  reason: z.string().min(1).optional(),
  // Its agent said there was nothing new: no alert, no send, no review (D-131).
  quiet: z.literal(true).optional(),
  // Where its result went, and a send that failed.
  delivery: deliverySchema.optional(),
  // Runs missed while Office Town was closed, kept as this one record.
  missed: z.number().int().positive().optional(),
  // How many runs in a row led to this one, for a chain.
  depth: z.number().int().nonnegative(),
  // What started it, for a run started by events.
  events: z.number().int().positive().optional(),
  // A waiting run is skipped after this.
  waitUntil: z.iso.datetime().optional(),
  taskId: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationRecordSchema = automationRequestSchema.extend({
  id: z.string().min(1),
  paused: automationPauseSchema.optional(),
  // Unset when off, paused, ended or chained.
  nextRunAt: z.iso.datetime().optional(),
  latestRun: automationRunSchema.optional(),
  // Failed runs in a row; three pause it.
  failures: z.number().int().nonnegative(),
  // Its source's last look, for a source that looks on its own: when, and how many were new.
  lastLook: z.object({ at: z.iso.datetime(), found: z.number().int().nonnegative() }).optional(),
  // The files every run sends, kept while it exists (D-125).
  files: z.array(attachmentSchema),
  // What its agents keep from run to run, given to each run as data (D-133).
  notes: z.string().max(NOTES_CHARS).optional(),
  // Sends that failed in a row, with the latest reason and place; three show a banner (D-130).
  sendFailures: z
    .object({
      count: z.number().int().positive(),
      reason: z.string().min(1),
      placeId: z.string().min(1).optional(),
    })
    .optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AutomationRecord = z.infer<typeof automationRecordSchema>;

export const automationListSchema = z.object({ automations: z.array(automationRecordSchema) });
export type AutomationList = z.infer<typeof automationListSchema>;

export const notesRequestSchema = z.object({ notes: z.string().max(NOTES_CHARS) });
export type NotesRequest = z.infer<typeof notesRequestSchema>;

export const enabledRequestSchema = z.object({ enabled: z.boolean() });
export type EnabledRequest = z.infer<typeof enabledRequestSchema>;

export const runTabSchema = z.enum(["all", "finished", "failed", "skipped"]);
export type RunTab = z.infer<typeof runTabSchema>;

export const RUN_TAB_STATUSES: Record<Exclude<RunTab, "all">, readonly RunStatus[]> = {
  finished: ["review", "done"],
  failed: ["failed", "stopped"],
  skipped: ["skipped"],
};

export const runPageQuerySchema = z.object({
  tab: runTabSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // The number of the last run on the page before.
  before: z.coerce.number().int().positive().optional(),
});
export type RunPageQuery = z.input<typeof runPageQuerySchema>;

// Newest first.
export const runPageSchema = z.object({
  runs: z.array(automationRunSchema),
  next: z.number().int().positive().optional(),
  counts: z.record(runTabSchema, z.number().int().nonnegative()),
});
export type RunPage = z.infer<typeof runPageSchema>;

// Read before saving: the next runs, and what Save would refuse or warn about.
export const automationPreviewRequestSchema = z.object({
  id: z.string().min(1).optional(),
  task: automationTaskSchema.optional(),
  trigger: triggerSchema,
});
export type AutomationPreviewRequest = z.input<typeof automationPreviewRequestSchema>;

export const automationPreviewSchema = z.object({
  nextRuns: z.array(z.iso.datetime()).max(3),
  // Save is refused: a chain that would loop or run too deep.
  problem: z.string().min(1).optional(),
  // Saving is allowed: "Same team and schedule as Weekly report".
  warning: z.string().min(1).optional(),
});
export type AutomationPreview = z.infer<typeof automationPreviewSchema>;

// The Describe box: the user's words drafted into every later step (D-125).
export const automationDraftSchema = z.object({
  name: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  // A department id, "assistant" or "chief".
  who: z.string().min(1),
  trigger: triggerSchema.optional(),
  rules: automationRulesSchema.partial().optional(),
});

export type AutomationDraft = z.infer<typeof automationDraftSchema>;

// What an agent check found (D-128): nothing, or new items, each with a key that stays the same
// when it is seen again, so it is never reported twice.
export const foundItemSchema = z.object({
  key: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(8_000),
});
export const checkFindingsSchema = z.object({
  found: z.boolean(),
  items: z.array(foundItemSchema).max(EVENTS_A_RUN).default([]),
});
export type CheckFindings = z.infer<typeof checkFindingsSchema>;
