import { z } from "zod";
import { absolutePathSchema } from "./options.ts";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

// Files and images are read-only copies in the data folder; a folder is the user's own, linked.
export const attachmentKindSchema = z.enum(["file", "image", "folder"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentSchema = z.object({
  id: z.string().min(1),
  kind: attachmentKindSchema,
  name: z.string().min(1),
  path: absolutePathSchema,
  // Not set on a folder.
  bytes: z.number().int().nonnegative().optional(),
  mimeType: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

// As sent with a message, by host path like an action's locations; `inline` says an image also
// went into the prompt itself.
export const sentAttachmentSchema = attachmentSchema
  .pick({ id: true, kind: true, name: true, bytes: true, mimeType: true })
  .extend({ path: z.string().min(1), inline: z.literal(true).optional() });
export type SentAttachment = z.infer<typeof sentAttachmentSchema>;

export const attachmentIdsSchema = z.array(z.string().min(1)).max(MAX_ATTACHMENTS);

export const linkFolderRequestSchema = z.object({ path: absolutePathSchema });
export type LinkFolderRequest = z.infer<typeof linkFolderRequestSchema>;
