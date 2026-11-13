import { z } from "zod";

const configOptionSchema = z.looseObject({
  id: z.string(),
  category: z.string().optional(),
  currentValue: z.unknown().optional(),
  options: z.array(z.looseObject({ value: z.string().optional() })).optional(),
});
export type ConfigOption = z.infer<typeof configOptionSchema>;

// `_meta.steering`: OpenCode 2 takes a message into a running turn (D-98).
export const initializeResultSchema = z.looseObject({
  agentCapabilities: z
    .looseObject({
      loadSession: z.boolean().optional(),
      sessionCapabilities: z.looseObject({ resume: z.unknown().optional() }).nullish(),
    })
    .optional(),
  _meta: z
    .looseObject({ steering: z.looseObject({ supported: z.boolean().optional() }).optional() })
    .nullish(),
});

export const steeringResultSchema = z.looseObject({ outcome: z.string() });

// A resumed session answers without its id: it is the one that was asked for.
export const sessionResultSchema = z.looseObject({
  sessionId: z.string().optional(),
  configOptions: z.array(configOptionSchema).optional(),
});

export const setOptionResultSchema = z.looseObject({
  configOptions: z.array(configOptionSchema).optional(),
});

export const promptResultSchema = z.looseObject({
  stopReason: z.string(),
  usage: z
    .looseObject({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      thoughtTokens: z.number().optional(),
      cachedReadTokens: z.number().optional(),
      cachedWriteTokens: z.number().optional(),
    })
    .optional(),
});

// OpenCode 2 marks what one of its sub-agents does with the sub-agent's own session.
const childSessionSchema = z.looseObject({
  "opencode/child-session": z
    .looseObject({ id: z.string(), title: z.string().optional() })
    .optional(),
});
export type ChildSession = NonNullable<
  z.infer<typeof childSessionSchema>["opencode/child-session"]
>;

export const updateParamsSchema = z.looseObject({
  update: z.looseObject({ sessionUpdate: z.string(), _meta: childSessionSchema.nullish() }),
});

// How long the conversation is and how much the model holds; OpenCode sends it as a prompt ends.
export const usageUpdateSchema = z.looseObject({
  used: z.number().int().nonnegative(),
  size: z.number().int().positive().optional(),
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
  rawOutput: z.unknown().optional(),
  _meta: childSessionSchema.nullish(),
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

// OpenCode 1's `task` names the sub-agent's type; OpenCode 2's `subagent` names its agent.
export const delegationInputSchema = z.union([
  z.looseObject({ subagent_type: z.string() }),
  z.looseObject({ agent: z.string(), description: z.string(), prompt: z.string() }),
]);

// What a sub-agent started by OpenCode 2 runs in, once the call that started it reports it;
// "running" while it works on in the background.
export const subagentOutputSchema = z.looseObject({
  metadata: z.looseObject({ sessionID: z.string(), status: z.string().optional() }),
});

// OpenCode 2's report of one of its sub-agents (`opencode/session/child_update`): a step of its
// own, or its status. It keeps reporting after the turn that started it ends.
export const childUpdateSchema = z.looseObject({
  childSessionId: z.string(),
  title: z.string().optional(),
  type: z.string(),
  status: z.string().optional(),
  update: z.looseObject({ sessionUpdate: z.string() }).optional(),
});

// The calls an OpenCode 2 Code Mode script made, in the order they started.
export const scriptOutputSchema = z.looseObject({
  metadata: z.looseObject({
    toolCalls: z.array(
      z.looseObject({ tool: z.string(), status: z.string(), input: z.unknown().optional() }),
    ),
  }),
});

const formOptionSchema = z.looseObject({
  const: z.unknown(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const formFieldSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  oneOf: z.array(formOptionSchema).optional(),
  items: z.looseObject({ anyOf: z.array(formOptionSchema).optional() }).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

// A question the agent asks the user, as an ACP form (`elicitation/create`).
export const elicitationParamsSchema = z.looseObject({
  mode: z.string().optional(),
  toolCallId: z.string().optional(),
  message: z.string().optional(),
  requestedSchema: z
    .looseObject({ properties: z.record(z.string(), formFieldSchema).optional() })
    .optional(),
});

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
