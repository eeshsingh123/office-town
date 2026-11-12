import { z } from "zod";

// What `codex app-server` sends, as far as the translator reads it (schema of codex-cli 0.164).

export const threadResultSchema = z.looseObject({
  thread: z.looseObject({ id: z.string().min(1) }),
  model: z.string().optional(),
});

export const turnResultSchema = z.looseObject({
  turn: z.looseObject({ id: z.string().min(1) }),
});

export const threadNoticeSchema = z.looseObject({ threadId: z.string().optional() });

export const itemSchema = z.looseObject({
  type: z.string(),
  id: z.string(),
  text: z.string().optional(),
  summary: z.array(z.string()).optional(),
  content: z.array(z.string()).optional(),
  command: z.string().optional(),
  cwd: z.string().nullish(),
  status: z.string().optional(),
  aggregatedOutput: z.string().nullish(),
  changes: z
    .array(z.looseObject({ path: z.string(), kind: z.unknown(), diff: z.string() }))
    .optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.unknown().optional(),
  result: z
    .looseObject({ content: z.array(z.looseObject({ text: z.string().optional() })) })
    .nullish(),
  error: z.looseObject({ message: z.string() }).nullish(),
  query: z.string().optional(),
  prompt: z.string().nullish(),
  path: z.string().optional(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemNoticeSchema = z.looseObject({ threadId: z.string(), item: itemSchema });

export const deltaSchema = z.looseObject({
  threadId: z.string(),
  itemId: z.string(),
  delta: z.string(),
});

const planStatusSchema = z
  .enum(["pending", "inProgress", "completed"])
  .catch("pending")
  .transform((status) => (status === "inProgress" ? ("in_progress" as const) : status));

export const planSchema = z.looseObject({
  threadId: z.string(),
  plan: z.array(z.looseObject({ step: z.string(), status: planStatusSchema })),
});

const breakdownSchema = z.looseObject({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
});
export type Breakdown = z.infer<typeof breakdownSchema>;

export const tokenUsageSchema = z.looseObject({
  threadId: z.string(),
  tokenUsage: z.looseObject({
    total: breakdownSchema,
    last: breakdownSchema,
    modelContextWindow: z.number().int().positive().nullish(),
  }),
});

export const turnCompletedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({
    id: z.string(),
    status: z.string(),
    error: z.looseObject({ message: z.string() }).nullish(),
  }),
});

export const errorNoticeSchema = z.looseObject({
  threadId: z.string().optional(),
  willRetry: z.boolean(),
  error: z.looseObject({ message: z.string() }),
});

const windowSchema = z.looseObject({
  usedPercent: z.number(),
  windowDurationMins: z.number().nullish(),
  resetsAt: z.number().nullish(),
});
export const rateLimitsSchema = z.looseObject({
  primary: windowSchema.nullish(),
  secondary: windowSchema.nullish(),
});
export type RateLimits = z.infer<typeof rateLimitsSchema>;

export const rateLimitsNoticeSchema = z.looseObject({ rateLimits: rateLimitsSchema });

export const approvalParamsSchema = z.looseObject({
  threadId: z.string(),
  itemId: z.string(),
  command: z.string().nullish(),
  cwd: z.string().nullish(),
  reason: z.string().nullish(),
});

// Codex asks before an app's call as an MCP form with the call in `_meta`, once the app's approval
// mode is "prompt" (checked live on 0.167.2).
export const appApprovalParamsSchema = z.looseObject({
  serverName: z.string().min(1),
  _meta: z.looseObject({
    codex_approval_kind: z.literal("mcp_tool_call"),
    tool_name: z.string().min(1),
    connector_id: z.string().min(1).nullish(),
    connector_name: z.string().min(1).nullish(),
    tool_params: z.unknown().optional(),
  }),
});

const statusToolSchema = z.looseObject({
  name: z.string().min(1),
  title: z.string().nullish(),
  description: z.string().nullish(),
  annotations: z.looseObject({ readOnlyHint: z.boolean().nullish() }).nullish(),
  _meta: z
    .looseObject({ connector_id: z.string().nullish(), connector_name: z.string().nullish() })
    .nullish(),
});
export type StatusTool = z.infer<typeof statusToolSchema>;

export const pluginInstallSchema = z.looseObject({
  appsNeedingAuth: z.array(z.looseObject({ installUrl: z.string().nullish() })),
});

export const mcpStatusListSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      name: z.string().min(1),
      authStatus: z.string(),
      toolsError: z.string().nullish(),
      tools: z.record(z.string(), statusToolSchema),
    }),
  ),
});

export const userInputParamsSchema = z.looseObject({
  threadId: z.string(),
  itemId: z.string(),
  questions: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        header: z.string(),
        question: z.string().min(1),
        options: z
          .array(z.looseObject({ label: z.string().min(1), description: z.string() }))
          .nullish(),
      }),
    )
    .min(1),
});

export const accountSchema = z.looseObject({
  account: z
    .looseObject({ type: z.string(), email: z.string().nullish(), planType: z.string().nullish() })
    .nullable(),
});

export const modelListSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      displayName: z.string().min(1),
      description: z.string().optional(),
      hidden: z.boolean().optional(),
      supportedReasoningEfforts: z.array(z.looseObject({ reasoningEffort: z.string().min(1) })),
      inputModalities: z.array(z.string()).optional(),
    }),
  ),
});
