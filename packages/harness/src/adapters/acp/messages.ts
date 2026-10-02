import { z } from "zod";

const configOptionSchema = z.looseObject({
  id: z.string(),
  category: z.string().optional(),
  currentValue: z.unknown().optional(),
  options: z.array(z.looseObject({ value: z.string().optional() })).optional(),
});
export type ConfigOption = z.infer<typeof configOptionSchema>;

export const newSessionResultSchema = z.looseObject({
  sessionId: z.string(),
  configOptions: z.array(configOptionSchema).optional(),
});

export const promptResultSchema = z.looseObject({
  stopReason: z.string(),
  usage: z
    .looseObject({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cachedReadTokens: z.number().optional(),
    })
    .optional(),
});

export const updateParamsSchema = z.looseObject({
  update: z.looseObject({ sessionUpdate: z.string() }),
});

export const usageUpdateSchema = z.looseObject({
  cost: z.looseObject({ amount: z.number(), currency: z.string() }).optional(),
});

export const chunkSchema = z.looseObject({
  messageId: z.string().optional(),
  content: z.looseObject({ type: z.string(), text: z.string().optional() }),
});

export const toolCallSchema = z.looseObject({
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  rawInput: z.unknown().optional(),
  locations: z.array(z.looseObject({ path: z.string() })).nullish(),
  content: z
    .array(
      z.looseObject({
        content: z.looseObject({ text: z.string().optional() }).optional(),
      }),
    )
    .nullish(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

const planStatusSchema = z.enum(["pending", "in_progress", "completed"]).catch("pending");

export const planSchema = z.looseObject({
  entries: z.array(z.looseObject({ content: z.string(), status: planStatusSchema })),
});

export const todoInputSchema = z.looseObject({
  todos: z.array(z.looseObject({ content: z.string(), status: planStatusSchema })),
});

export const delegationInputSchema = z.looseObject({ subagent_type: z.string() });

export const permissionParamsSchema = z.looseObject({
  toolCall: toolCallSchema,
  options: z
    .array(
      z.looseObject({
        optionId: z.string(),
        name: z.string(),
        kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
      }),
    )
    .min(1),
});
