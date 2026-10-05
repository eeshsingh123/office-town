import { z } from "zod";
import { messageOriginSchema, questionAnswerSchema } from "./events.ts";

const answerPermissionSchema = z.object({
  type: z.literal("answerPermission"),
  requestId: z.string().min(1),
  optionId: z.string().min(1),
});

const answerQuestionSchema = z.object({
  type: z.literal("answerQuestion"),
  requestId: z.string().min(1),
  answers: z.array(questionAnswerSchema).min(1),
});

const interruptSchema = z.object({ type: z.literal("interrupt") });

// Starting and stopping belong to whoever owns the session, so only these reach a running agent.
export const agentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  answerPermissionSchema,
  answerQuestionSchema,
  interruptSchema,
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;

// What the core may send a session: the user's commands, and messages of its own.
export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({
    type: z.literal("prompt"),
    text: z.string().min(1),
    origin: messageOriginSchema.optional(),
  }),
  answerPermissionSchema,
  answerQuestionSchema,
  interruptSchema,
  z.object({ type: z.literal("stop") }),
]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;
