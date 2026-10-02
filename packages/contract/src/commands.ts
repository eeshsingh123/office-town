import { z } from "zod";

export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  z.object({
    type: z.literal("answerPermission"),
    requestId: z.string().min(1),
    optionId: z.string().min(1),
  }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("stop") }),
]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;
