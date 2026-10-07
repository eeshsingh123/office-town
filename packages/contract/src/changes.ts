import { z } from "zod";
import { agentRecordSchema } from "./agents.ts";
import { harnessLimitsSchema, taskRecordSchema } from "./api.ts";
import { planPieceSchema } from "./plans.ts";
import { delegationRecordSchema, departmentRecordSchema } from "./team.ts";

// Sent whole on the live stream, never stored: a reconnecting client reads the records again.
export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), task: taskRecordSchema }),
  z.object({ type: z.literal("task.deleted"), taskId: z.string().min(1) }),
  z.object({ type: z.literal("agent"), agent: agentRecordSchema }),
  z.object({ type: z.literal("department"), department: departmentRecordSchema }),
  z.object({ type: z.literal("delegation"), delegation: delegationRecordSchema }),
  z.object({ type: z.literal("limits"), limits: harnessLimitsSchema }),
  z.object({ type: z.literal("piece"), piece: planPieceSchema }),
]);
export type Change = z.infer<typeof changeSchema>;
