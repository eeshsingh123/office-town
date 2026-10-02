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
  }),
  reasoning: z.object({
    text: z.string(),
    parentActionId: z.string().optional(),
  }),
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
  }),
  "action.ended": z.object({
    actionId: z.string().min(1),
    outcome: z.enum(["completed", "failed"]),
    result: z.string(),
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
  eventOf("plan.updated"),
  eventOf("action.started"),
  eventOf("action.updated"),
  eventOf("action.ended"),
  eventOf("permission.requested"),
  eventOf("permission.resolved"),
  eventOf("error"),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export type SessionEventBody = {
  [E in SessionEvent as E["type"]]: Pick<E, "type" | "payload">;
}[SessionEvent["type"]];
