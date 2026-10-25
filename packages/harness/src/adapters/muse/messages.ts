import { z } from "zod";

// What `muse serve` sends, as far as the translator reads it (MSP schema 1, Muse Code 1.4).

export const sessionResultSchema = z.looseObject({
  session: z.looseObject({ sessionId: z.string().min(1), modelId: z.string().nullish() }),
});

export const turnResultSchema = z.looseObject({ turnId: z.string().min(1) });

export const sessionNoticeSchema = z.looseObject({ sessionId: z.string().optional() });

export const itemSchema = z.looseObject({
  itemId: z.string(),
  kind: z.string(),
  status: z.string(),
  text: z.string().optional(),
  summary: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: z.string().optional(),
  displayLabel: z.looseObject({ active: z.string(), neutral: z.string() }).optional(),
  visibleOutput: z.string().optional(),
  failureReason: z.string().optional(),
  objective: z.string().optional(),
  role: z.string().optional(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemNoticeSchema = z.looseObject({ item: itemSchema });

export const deltaSchema = z.looseObject({
  itemId: z.string(),
  field: z.string().optional(),
  delta: z.string(),
});

// Per model call: the whole prompt it read, and all it read and wrote.
export const tokenUsageSchema = z.looseObject({
  usage: z.looseObject({ cachedTokens: z.number() }),
  promptTokens: z.number(),
  totalTokens: z.number(),
});

export const turnCompletedSchema = z.looseObject({
  turnId: z.string(),
  terminal: z.string(),
  error: z.looseObject({ message: z.string() }).optional(),
});

export const todoSchema = z.looseObject({
  items: z.array(z.looseObject({ text: z.string(), status: z.string() })),
});

// The `usage/read` and `usage/changed` shape, and what `muse usage --json` prints.
export const subscriptionSchema = z.looseObject({
  tier: z.string(),
  window: z.looseObject({
    usedPercent: z.number(),
    resetsAtMs: z.number(),
    windowDurationMins: z.number(),
  }),
  weekly: z.looseObject({ usedPercent: z.number(), resetsAtMs: z.number() }),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

const choiceSchema = z.looseObject({
  choiceId: z.string().min(1),
  decision: z.string(),
  label: z.string(),
});

export const approvalSchema = z.looseObject({
  approvalId: z.string().min(1),
  itemId: z.string(),
  toolName: z.string(),
  rawArgs: z.string(),
  currentRequirementId: z.unknown(),
  availableChoices: z.array(choiceSchema),
  subject: z.looseObject({
    kind: z.string(),
    command: z.string().optional(),
    path: z.string().optional(),
    target: z.string().optional(),
  }),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalResolvedSchema = z.looseObject({
  approvalId: z.string(),
  decision: z.string(),
});

export const userInputSchema = z.looseObject({
  userInputId: z.string().min(1),
  itemId: z.string(),
  questions: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        header: z.string(),
        question: z.string().min(1),
        options: z.array(
          z.looseObject({ label: z.string().min(1), description: z.string().optional() }),
        ),
        selection: z.looseObject({ mode: z.string() }),
      }),
    )
    .min(1),
});

export const modelListSchema = z.looseObject({
  models: z.array(
    z.looseObject({
      modelId: z.string().min(1),
      displayLabel: z.string().min(1),
      description: z.string().nullish(),
      reasoningEffortVariants: z.array(z.looseObject({ tier: z.string().min(1) })).optional(),
      variants: z.union([z.array(z.string()), z.string()]).optional(),
    }),
  ),
});
