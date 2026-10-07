import { z } from "zod";
import { agentSettingsSchema } from "./agents.ts";
import { autonomySchema } from "./autonomy.ts";
import { roleSettingsSchema } from "./team.ts";

// A department the chief proposes for a piece; its lead proposes the team once the piece starts.
const proposedDepartmentSchema = z.object({
  name: z.string().trim().min(1),
  // What it does, in a few words.
  purpose: z.string().trim(),
  lead: roleSettingsSchema,
});

// Where the user put the new department when approving the plan.
const placedDepartmentSchema = proposedDepartmentSchema.extend({
  workspaceId: z.string().min(1),
  autonomy: autonomySchema,
});
export type PlacedDepartment = z.infer<typeof placedDepartmentSchema>;

const pieceFieldsShape = {
  // A short name the chief chose, unique among the plan's pieces that are not dropped.
  key: z.string().trim().min(1),
  title: z.string().trim().min(1),
  // What the department is to do; it stands alone.
  brief: z.string().trim().min(1),
};

// A piece as the chief proposes it: `waitsOn` names other pieces by key.
export const proposedPieceSchema = z.object({
  ...pieceFieldsShape,
  waitsOn: z.array(z.string().min(1)),
  department: z.union([
    z.object({ departmentId: z.string().min(1) }),
    z.object({ newDepartment: proposedDepartmentSchema }),
  ]),
});
export type ProposedPiece = z.infer<typeof proposedPieceSchema>;

// A piece as the user approved it, after their changes; a new department has its place.
export const approvedPieceSchema = proposedPieceSchema.extend({
  department: z.union([
    z.object({ departmentId: z.string().min(1) }),
    z.object({ newDepartment: placedDepartmentSchema }),
  ]),
});
export type ApprovedPiece = z.infer<typeof approvedPieceSchema>;

// waiting: on the pieces before it. queued: its department is busy. dropped: left out of a
// changed plan, or of a goal that ended before it started.
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

// One department's part of a chief's goal. A piece for a new department carries it until the
// department exists; from then on `departmentId` is set too.
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
  // The department's task for this piece, once it started.
  pieceTaskId: z.string().min(1).optional(),
  // The department lead's last message, once the piece ended.
  result: z.string().optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type PlanPiece = z.infer<typeof planPieceSchema>;

// The one standing chief's settings; a change applies at its next session.
export const chiefRequestSchema = z.object({ settings: agentSettingsSchema });
export type ChiefRequest = z.infer<typeof chiefRequestSchema>;

export const chiefTaskRequestSchema = z.object({ goal: z.string().min(1) });
export type ChiefTaskRequest = z.infer<typeof chiefTaskRequestSchema>;
