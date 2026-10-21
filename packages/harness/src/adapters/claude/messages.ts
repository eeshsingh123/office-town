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
          resolvedModel: z.string().optional(),
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

const callUsageSchema = z.looseObject({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
});

export const assistantSchema = z.looseObject({
  // One model call's usage; the CLI repeats it on every line of that call.
  message: z.looseObject({ content: z.array(blockSchema), usage: callUsageSchema.optional() }),
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
  // Set for an MCP tool; "claudeai" for one of the user's claude.ai connectors.
  mcp_server: z.looseObject({ name: z.string(), source: z.string().optional() }).optional(),
});

// The answer to an mcp_status control request: every server the CLI connects, with its tools.
export const mcpStatusResponseSchema = z.looseObject({
  type: z.literal("control_response"),
  response: z.looseObject({
    request_id: z.string(),
    response: z.looseObject({
      mcpServers: z.array(
        z.looseObject({
          name: z.string(),
          status: z.string(),
          source: z.string().optional(),
          tools: z
            .array(
              z.looseObject({
                name: z.string(),
                description: z.string().optional(),
                annotations: z.looseObject({ readOnly: z.boolean().optional() }).optional(),
              }),
            )
            .optional(),
        }),
      ),
    }),
  }),
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
  usage: callUsageSchema.optional(),
});

// `claude auth status --json`; the rest of its fields are not needed.
// The sign-in file the CLI keeps in its config folder; only what reading usage needs.
export const credentialsSchema = z.looseObject({
  claudeAiOauth: z
    .looseObject({ accessToken: z.string().min(1), expiresAt: z.number().optional() })
    .optional(),
});

// The plan usage the CLI's own /usage shows; `utilization` is a percentage.
export const planUsageSchema = z.record(
  z.string(),
  z.unknown().transform((value) => {
    const window = z
      .looseObject({ utilization: z.number(), resets_at: z.string().nullish() })
      .safeParse(value);
    return window.success ? window.data : undefined;
  }),
);

export const authStatusSchema = z.looseObject({
  loggedIn: z.boolean(),
  email: z.string().optional(),
  subscriptionType: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});

export const rateLimitSchema = z.looseObject({
  rate_limit_info: z.looseObject({
    // "rejected" once a window is used up; `rateLimitType` names that window.
    status: z.string().optional(),
    rateLimitType: z.string().optional(),
    unifiedWindows: z
      .record(
        z.string(),
        z.looseObject({ utilization: z.number(), resetsAt: z.number().optional() }),
      )
      .optional(),
  }),
});

export const taskCreateInputSchema = z.looseObject({ subject: z.string() });

// The model may name the fields otherwise, such as "task_id", and the CLI accepts them; read its record.
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
