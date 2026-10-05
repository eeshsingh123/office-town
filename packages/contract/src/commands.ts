import { z } from "zod";
import { answeredBySchema } from "./autonomy.ts";
import { messageOriginSchema, questionAnswerSchema } from "./events.ts";
import { teamSchema } from "./team.ts";

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

const answerProposalSchema = z.object({
  type: z.literal("answerProposal"),
  requestId: z.string().min(1),
  answer: z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("approved"), team: teamSchema }),
    z.object({ outcome: z.literal("revised"), note: z.string().trim().min(1) }),
    z.object({ outcome: z.literal("declined"), note: z.string().trim().optional() }),
  ]),
});

const interruptSchema = z.object({ type: z.literal("interrupt") });

// Starting and stopping belong to whoever owns the session, so only these reach a running agent.
export const agentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  answerPermissionSchema,
  answerQuestionSchema,
  answerProposalSchema,
  interruptSchema,
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;

// What the core may send a harness session: the user's commands, and messages of its own. A
// proposal is the core's own request, so its answer never reaches the harness.
export const sessionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({
    type: z.literal("prompt"),
    text: z.string().min(1),
    origin: messageOriginSchema.optional(),
  }),
  answerPermissionSchema.extend({ answeredBy: answeredBySchema.optional() }),
  answerQuestionSchema,
  interruptSchema,
  // `idle` ends the session as finished rather than stopped by the user.
  z.object({ type: z.literal("stop"), idle: z.literal(true).optional() }),
]);
export type SessionCommand = z.infer<typeof sessionCommandSchema>;
