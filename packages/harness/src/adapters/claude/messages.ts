import { z } from "zod";

const toolResultContentSchema = z.union([
  z.string(),
  z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
]);
export type ToolResultContent = z.infer<typeof toolResultContentSchema>;

const blockSchema = z.looseObject({ type: z.string() });

export const textBlockSchema = z.looseObject({ text: z.string() });

export const thinkingBlockSchema = z.looseObject({ thinking: z.string() });

export const toolUseSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolUse = z.infer<typeof toolUseSchema>;

export const toolResultSchema = z.looseObject({
  tool_use_id: z.string(),
  content: toolResultContentSchema.optional(),
  is_error: z.boolean().optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;

export const headerSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
});

export const initSchema = z.looseObject({
  session_id: z.string(),
  model: z.string().optional(),
});

export const initializeResponseSchema = z.looseObject({
  response: z.looseObject({
    response: z.looseObject({
      models: z.array(
        z.looseObject({
          value: z.string(),
          displayName: z.string(),
          description: z.string().optional(),
          supportedEffortLevels: z.array(z.string()).optional(),
        }),
      ),
    }),
  }),
});

export const streamEventSchema = z.looseObject({
  event: z.looseObject({
    type: z.string(),
    delta: z
      .looseObject({ text: z.string().optional(), thinking: z.string().optional() })
      .optional(),
  }),
  parent_tool_use_id: z.string().nullish(),
});

export const assistantSchema = z.looseObject({
  message: z.looseObject({ content: z.array(blockSchema) }),
  parent_tool_use_id: z.string().nullish(),
});

export const userSchema = z.looseObject({
  message: z.looseObject({ content: z.union([z.string(), z.array(blockSchema)]) }),
  parent_tool_use_id: z.string().nullish(),
  // The CLI's own record of the tool call the message answers.
  tool_use_result: z.unknown().optional(),
});

export const taskStartedSchema = z.looseObject({
  tool_use_id: z.string().optional(),
  is_backgrounded: z.boolean().optional(),
});

export const taskNotificationSchema = z.looseObject({
  tool_use_id: z.string().optional(),
  status: z.string(),
  summary: z.string().optional(),
});

export const controlRequestSchema = z.looseObject({
  request_id: z.string(),
  request: z.looseObject({ subtype: z.string() }),
});

export const permissionRequestSchema = z.looseObject({
  tool_name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string().optional(),
  permission_suggestions: z.array(z.unknown()).optional(),
});

export const permissionSuggestionSchema = z.looseObject({
  type: z.string(),
  destination: z.string().optional(),
  mode: z.string().optional(),
  behavior: z.string().optional(),
  rules: z
    .array(z.looseObject({ toolName: z.string(), ruleContent: z.string().optional() }))
    .optional(),
  directories: z.array(z.string()).optional(),
});
export type PermissionSuggestion = z.infer<typeof permissionSuggestionSchema>;

export const questionsInputSchema = z.looseObject({
  questions: z
    .array(
      z.looseObject({
        question: z.string(),
        header: z.string().optional(),
        options: z
          .array(z.looseObject({ label: z.string(), description: z.string().optional() }))
          .optional(),
        multiSelect: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type AskedQuestion = z.infer<typeof questionsInputSchema>["questions"][number];

export const controlCancelSchema = z.looseObject({ request_id: z.string() });

export const resultSchema = z.looseObject({
  is_error: z.boolean(),
  subtype: z.string(),
  terminal_reason: z.string().optional(),
  result: z.string().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .optional(),
});

export const rateLimitSchema = z.looseObject({
  rate_limit_info: z.looseObject({
    unifiedWindows: z
      .record(
        z.string(),
        z.looseObject({ utilization: z.number(), resetsAt: z.number().optional() }),
      )
      .optional(),
  }),
});

export const taskCreateInputSchema = z.looseObject({ subject: z.string() });

// What the CLI recorded for a task tool call. The model may name the input fields otherwise, such
// as "title" or "task_id", and the CLI still accepts them, so its record is the one to read.
export const taskCreatedSchema = z.looseObject({
  task: z.looseObject({ id: z.string(), subject: z.string() }),
});
export const taskUpdatedSchema = z.looseObject({
  taskId: z.string(),
  statusChange: z.looseObject({ to: z.string() }).optional(),
});
export const taskUpdateFieldsSchema = z.looseObject({
  status: z.string().optional(),
  subject: z.string().optional(),
});

export const taskUpdateInputSchema = z.looseObject({
  taskId: z.string(),
  status: z.string().optional(),
  subject: z.string().optional(),
});
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>;
