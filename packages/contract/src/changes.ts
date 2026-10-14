import { z } from "zod";
import { accountLimitsSchema } from "./accounts.ts";
import { agentRecordSchema } from "./agents.ts";
import { taskRecordSchema } from "./api.ts";
import { libraryItemSchema } from "./library.ts";
import { planPieceSchema } from "./plans.ts";
import { delegationRecordSchema, departmentRecordSchema } from "./team.ts";

// Sent whole on the live stream, never stored: a reconnecting client reads the records again.
export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), task: taskRecordSchema }),
  z.object({ type: z.literal("task.deleted"), taskId: z.string().min(1) }),
  z.object({ type: z.literal("agent"), agent: agentRecordSchema }),
  z.object({ type: z.literal("department"), department: departmentRecordSchema }),
  z.object({ type: z.literal("department.removed"), departmentId: z.string().min(1) }),
  z.object({ type: z.literal("delegation"), delegation: delegationRecordSchema }),
  z.object({ type: z.literal("limits"), limits: accountLimitsSchema }),
  z.object({ type: z.literal("piece"), piece: planPieceSchema }),
  z.object({ type: z.literal("library"), item: libraryItemSchema }),
  z.object({ type: z.literal("library.removed"), itemId: z.string().min(1) }),
]);
export type Change = z.infer<typeof changeSchema>;
