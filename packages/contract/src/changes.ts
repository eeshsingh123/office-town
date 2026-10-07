import { z } from "zod";
import { agentRecordSchema } from "./agents.ts";
import { harnessLimitsSchema, taskRecordSchema } from "./api.ts";
import { delegationRecordSchema, departmentRecordSchema } from "./team.ts";

// A record the core changed, sent whole on the live stream so the UI replaces its copy. Changes
// are not stored: a client that reconnects reads the records again.
export const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), task: taskRecordSchema }),
  z.object({ type: z.literal("task.deleted"), taskId: z.string().min(1) }),
  z.object({ type: z.literal("agent"), agent: agentRecordSchema }),
  z.object({ type: z.literal("department"), department: departmentRecordSchema }),
  z.object({ type: z.literal("delegation"), delegation: delegationRecordSchema }),
  z.object({ type: z.literal("limits"), limits: harnessLimitsSchema }),
]);
export type Change = z.infer<typeof changeSchema>;
