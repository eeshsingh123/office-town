import { z } from "zod";

// What happened, told once (D-137). "living" is a task at work, drawn from its trace while it runs.
export const feedKindSchema = z.enum([
  "needs-you",
  "living",
  "result",
  "milestone",
  "stopped",
  "automation",
  "heads-up",
  "suggested",
]);
export type FeedKind = z.infer<typeof feedKindSchema>;

// Who a post is from: an agent, an automation, or Office Town itself.
export const feedAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1) }),
  z.object({
    kind: z.literal("automation"),
    automationId: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({ kind: z.literal("app") }),
]);
export type FeedAuthor = z.infer<typeof feedAuthorSchema>;

// Why work stopped, named plainly on the post.
export const stopReasonSchema = z.enum(["failed", "usage", "closed"]);
export type StopReason = z.infer<typeof stopReasonSchema>;

// Repeated requests and an agent's named follow-up; each can be quietened for 30 days.
export const suggestionRuleSchema = z.enum(["repeat", "follow-up"]);
export type SuggestionRule = z.infer<typeof suggestionRuleSchema>;

// "Set it up" opens a filled-in form; nothing starts on its own (D-139).
export const suggestionSchema = z.object({
  rule: suggestionRuleSchema,
  why: z.string().min(1),
  open: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("task"),
      prompt: z.string().min(1),
      departmentId: z.string().min(1).optional(),
    }),
    z.object({ kind: z.literal("automation"), describe: z.string().min(1) }),
  ]),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const FEED_TITLE_CHARS = 160;
export const FEED_BODY_CHARS = 1200;

export const feedPostSchema = z.object({
  id: z.string().min(1),
  kind: feedKindSchema,
  by: feedAuthorSchema,
  title: z.string().min(1).max(FEED_TITLE_CHARS),
  // Markdown for a result's opening lines; plain text otherwise.
  body: z.string().max(FEED_BODY_CHARS).optional(),
  taskId: z.string().min(1).optional(),
  // The session a reply or an ask belongs to.
  sessionId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  // "open": an ask waiting or a task at work.
  state: z.enum(["open", "answered", "ended"]),
  stopped: stopReasonSchema.optional(),
  // Folded repeats, such as three parts of a goal finished close together.
  count: z.number().int().min(2).optional(),
  // An agent's own words that came past its cap, shown on its living card.
  note: z.string().min(1).optional(),
  suggestion: suggestionSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FeedPost = z.infer<typeof feedPostSchema>;

export const feedShowSchema = z.enum(["all", "needs-you", "results", "automations", "suggested"]);
export type FeedShow = z.infer<typeof feedShowSchema>;

export const FEED_PAGE = 50;

export const feedQuerySchema = z.object({
  // The last post of the page before.
  before: z.string().min(1).optional(),
  show: feedShowSchema.default("all"),
  departmentId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const feedPageSchema = z.object({
  posts: z.array(feedPostSchema),
  more: z.boolean(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export const feedSeenRequestSchema = z.object({ at: z.iso.datetime() });
export const suggestionsRequestSchema = z.object({ on: z.boolean() });
