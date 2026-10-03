import { z } from "zod";
import { questionAnswerSchema } from "./events.ts";

// Starting and stopping belong to whoever owns the session, so only these reach a running agent.
export const agentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  z.object({
    type: z.literal("answerPermission"),
    requestId: z.string().min(1),
    optionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("answerQuestion"),
    requestId: z.string().min(1),
    answers: z.array(questionAnswerSchema).min(1),
  }),
  z.object({ type: z.literal("interrupt") }),
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;

export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  ...agentCommandSchema.options,
  z.object({ type: z.literal("stop") }),
]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;
