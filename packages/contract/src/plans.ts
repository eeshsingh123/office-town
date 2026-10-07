import { z } from "zod";
import { agentSettingsSchema } from "./agents.ts";
import { autonomySchema } from "./autonomy.ts";
import { roleSettingsSchema } from "./team.ts";

// Its lead proposes the team once the piece starts.
const proposedDepartmentSchema = z.object({
  name: z.string().trim().min(1),
  purpose: z.string().trim(),
  lead: roleSettingsSchema,
});

// With the place the user chose when approving the plan.
const placedDepartmentSchema = proposedDepartmentSchema.extend({
  workspaceId: z.string().min(1),
  autonomy: autonomySchema,
});
export type PlacedDepartment = z.infer<typeof placedDepartmentSchema>;

const pieceFieldsShape = {
  // Unique among the plan's pieces that are not dropped.
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  // It stands alone.
  brief: z.string().trim().min(1),
};

// `waitsOn` names other pieces by key.
export const proposedPieceSchema = z.object({
  ...pieceFieldsShape,
  waitsOn: z.array(z.string().min(1)),
  department: z.union([
    z.object({ departmentId: z.string().min(1) }),
    z.object({ newDepartment: proposedDepartmentSchema }),
  ]),
});
export type ProposedPiece = z.infer<typeof proposedPieceSchema>;

export const approvedPieceSchema = proposedPieceSchema.extend({
  department: z.union([
    z.object({ departmentId: z.string().min(1) }),
    z.object({ newDepartment: placedDepartmentSchema }),
  ]),
});
export type ApprovedPiece = z.infer<typeof approvedPieceSchema>;

// queued: its department is busy. dropped: left out of a changed plan or an ended goal.
export const pieceStatusSchema = z.enum([
  "waiting",
  "queued",
  "working",
  "done",
  "failed",
  "stopped",
  "dropped",
]);
export type PieceStatus = z.infer<typeof pieceStatusSchema>;

// A piece for a new department carries it until the department exists, then `departmentId` too.
export const planPieceSchema = z.object({
  id: z.string().min(1),
  // The chief's task.
  taskId: z.string().min(1),
  ...pieceFieldsShape,
  departmentId: z.string().min(1).optional(),
  newDepartment: placedDepartmentSchema.optional(),
  // Piece ids.
  waitsOn: z.array(z.string().min(1)),
  status: pieceStatusSchema,
  // The department's task for this piece.
  pieceTaskId: z.string().min(1).optional(),
  // The department lead's last message.
  result: z.string().optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type PlanPiece = z.infer<typeof planPieceSchema>;

// A change applies at its next session.
export const chiefRequestSchema = z.object({ settings: agentSettingsSchema });
export type ChiefRequest = z.infer<typeof chiefRequestSchema>;

export const chiefTaskRequestSchema = z.object({ goal: z.string().min(1) });
export type ChiefTaskRequest = z.infer<typeof chiefTaskRequestSchema>;
