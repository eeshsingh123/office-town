import { z } from "zod";
import { questionAnswerSchema } from "./events.ts";

export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
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
  z.object({ type: z.literal("stop") }),
]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;
