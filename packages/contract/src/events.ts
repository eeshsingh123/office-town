import { z } from "zod";

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const actionKindSchema = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "fetch",
  "think",
  "delegate",
  "other",
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const permissionOptionSchema = z.object({
  optionId: z.string().min(1),
  label: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});
export type PermissionOption = z.infer<typeof permissionOptionSchema>;

export const questionSchema = z.object({
  questionId: z.string().min(1),
  text: z.string().min(1),
  header: z.string().optional(),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })),
  multiSelect: z.boolean(),
});
export type Question = z.infer<typeof questionSchema>;

// Each selected value is an option's label, or the user's own words when no option fits.
export const questionAnswerSchema = z.object({
  questionId: z.string().min(1),
  selected: z.array(z.string().min(1)).min(1),
});
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;

// Why the core, not the user, sent an agent a message.
export const messageOriginSchema = z.discriminatedUnion("kind", [
  // The agent's instructions and its piece of work. `summary` is the one line shown for it.
  z.object({ kind: z.literal("brief"), summary: z.string().min(1) }),
]);
export type MessageOrigin = z.infer<typeof messageOriginSchema>;

// A usage window of the user's subscription, as the harness reports it.
export const usageLimitSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  usedFraction: z.number().nonnegative(),
  resetsAt: z.iso.datetime().optional(),
});
export type UsageLimit = z.infer<typeof usageLimitSchema>;

// A fragment of text as it is produced. The whole text always follows as a message or reasoning
// event, so a consumer may ignore fragments entirely.
const deltaSchema = z.object({
  text: z.string().min(1),
  parentActionId: z.string().optional(),
});

// Set when the text beside it is only part of a text `bytes` long in UTF-8. `truncated` means the
// whole text cannot be read back: on `action.ended` the copy stored apart was cut at the size cap;
// on `action.updated` nothing is stored apart, as the whole output follows with `action.ended`.
export const overflowSchema = z.object({
  bytes: z.number().int().positive(),
  truncated: z.boolean(),
});
export type Overflow = z.infer<typeof overflowSchema>;

const payloadSchemas = {
  "session.started": z.object({
    harnessSessionId: z.string().min(1),
    model: z.string().optional(),
  }),
  "session.ended": z.object({
    reason: z.enum(["stopped", "exited", "failed"]),
    exitCode: z.number().int().nullable(),
  }),
  "turn.started": z.object({ turnId: z.string().min(1) }),
  "turn.ended": z.object({
    turnId: z.string().min(1),
    outcome: z.enum(["completed", "interrupted", "failed"]),
    usage: tokenUsageSchema.optional(),
  }),
  message: z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    parentActionId: z.string().optional(),
    // Set on a message the core sent in the user's place.
    origin: messageOriginSchema.optional(),
  }),
  reasoning: z.object({
    text: z.string(),
    parentActionId: z.string().optional(),
  }),
  "message.delta": deltaSchema,
  "reasoning.delta": deltaSchema,
  "plan.updated": z.object({ steps: z.array(planStepSchema) }),
  "action.started": z.object({
    actionId: z.string().min(1),
    kind: actionKindSchema,
    title: z.string(),
    input: z.unknown(),
    locations: z.array(z.string()).optional(),
    parentActionId: z.string().optional(),
    planStepId: z.string().optional(),
  }),
  "action.updated": z.object({
    actionId: z.string().min(1),
    title: z.string().optional(),
    output: z.string().optional(),
    overflow: overflowSchema.optional(),
  }),
  "action.ended": z.object({
    actionId: z.string().min(1),
    outcome: z.enum(["completed", "failed"]),
    result: z.string(),
    overflow: overflowSchema.optional(),
  }),
  "permission.requested": z.object({
    requestId: z.string().min(1),
    actionId: z.string().optional(),
    title: z.string(),
    input: z.unknown(),
    options: z.array(permissionOptionSchema).min(1),
  }),
  "permission.resolved": z.object({
    requestId: z.string().min(1),
    outcome: z.enum(["allowed", "denied", "cancelled"]),
    optionId: z.string().optional(),
  }),
  "question.requested": z.object({
    requestId: z.string().min(1),
    actionId: z.string().optional(),
    questions: z.array(questionSchema).min(1),
  }),
  "question.resolved": z.object({
    requestId: z.string().min(1),
    outcome: z.enum(["answered", "cancelled"]),
    answers: z.array(questionAnswerSchema).optional(),
  }),
  "limits.updated": z.object({ limits: z.array(usageLimitSchema).min(1) }),
  error: z.object({
    message: z.string(),
    detail: z.string().optional(),
    fatal: z.boolean(),
  }),
};

const envelopeShape = {
  id: z.uuid(),
  sessionId: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
};

function eventOf<T extends keyof typeof payloadSchemas>(type: T) {
  return z.object({ ...envelopeShape, type: z.literal(type), payload: payloadSchemas[type] });
}

export const sessionEventSchema = z.discriminatedUnion("type", [
  eventOf("session.started"),
  eventOf("session.ended"),
  eventOf("turn.started"),
  eventOf("turn.ended"),
  eventOf("message"),
  eventOf("reasoning"),
  eventOf("message.delta"),
  eventOf("reasoning.delta"),
  eventOf("plan.updated"),
  eventOf("action.started"),
  eventOf("action.updated"),
  eventOf("action.ended"),
  eventOf("permission.requested"),
  eventOf("permission.resolved"),
  eventOf("question.requested"),
  eventOf("question.resolved"),
  eventOf("limits.updated"),
  eventOf("error"),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export type SessionEventBody = {
  [E in SessionEvent as E["type"]]: Pick<E, "type" | "payload">;
}[SessionEvent["type"]];

// What an agent waits on the user for: the events behind the blocked queue.
export const userRequestEventSchema = z.discriminatedUnion("type", [
  eventOf("permission.requested"),
  eventOf("question.requested"),
]);
export type UserRequestEvent = z.infer<typeof userRequestEventSchema>;
