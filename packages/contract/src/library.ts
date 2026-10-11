import { z } from "zod";
import { attachmentSchema } from "./attachments.ts";

// Everyone in the workspace, or the departments and agents named (D-64).
export const libraryAudienceSchema = z.object({
  everyone: z.boolean(),
  departmentIds: z.array(z.string().min(1)),
  agentIds: z.array(z.string().min(1)),
});
export type LibraryAudience = z.infer<typeof libraryAudienceSchema>;

// A request always gives an item to someone.
const givenToSchema = libraryAudienceSchema.refine(
  (audience) => audience.everyone || audience.departmentIds.length + audience.agentIds.length > 0,
  "Give it to everyone or to at least one department or agent",
);

// A reference file or folder a workspace keeps for its agents; `file` changes only through Replace.
export const libraryItemSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  file: attachmentSchema,
  givenTo: libraryAudienceSchema,
  // Not set when the user added it.
  addedByAgentId: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  // The tasks it was given in, and those whose agents opened it.
  givenIn: z.number().int().nonnegative(),
  openedIn: z.number().int().nonnegative(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

// The file is uploaded or the folder linked first, through the attachment routes.
export const newLibraryItemRequestSchema = z.object({
  attachmentId: z.string().min(1),
  givenTo: givenToSchema,
});
export type NewLibraryItemRequest = z.infer<typeof newLibraryItemRequestSchema>;

// `attachmentId` replaces the file with one uploaded since.
export const libraryItemChangeSchema = z.object({
  attachmentId: z.string().min(1).optional(),
  givenTo: givenToSchema.optional(),
});
export type LibraryItemChange = z.infer<typeof libraryItemChangeSchema>;
