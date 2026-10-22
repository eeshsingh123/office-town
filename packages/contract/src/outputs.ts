import { z } from "zod";

// Limits the core and the viewer share (M8, owner).
export const MAX_KEPT_VERSION_BYTES = 10 * 1024 * 1024;
export const MAX_PREVIEW_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_TABLE_ROWS = 1000;
// Past this a file opens in its default app instead of in the viewer.
export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
export const MAX_PICTURE_BYTES = 1024 * 1024;

// What "Open with default app" opens, by extension: documents, pictures, media, models and
// archives, whose apps show them without running anything an agent wrote. Anything else is
// shown in its folder instead (M8).
export const OPENS_SAFELY: ReadonlySet<string> = new Set(
  (
    "doc docx xls xlsx ppt pptx odt ods odp odg rtf epub pages numbers key " +
    "png jpg jpeg gif webp bmp tif tiff heic avif ico psd fig sketch xd " +
    "mp3 wav ogg flac m4a aac mp4 mov webm mkv avi " +
    "stl obj glb gltf fbx 3mf ttf otf woff woff2 zip 7z rar tar gz " +
    "txt log md csv tsv json xml yaml yml"
  ).split(" "),
);

// A file an agent wrote, or a local address its server serves.
export const outputTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({ kind: z.literal("site"), url: z.url() }),
]);
export type OutputTarget = z.infer<typeof outputTargetSchema>;

// Each time the agent shows the file again. `kept`: a copy was saved to go back to.
export const outputVersionSchema = z.object({
  number: z.number().int().positive(),
  at: z.iso.datetime(),
  kept: z.boolean(),
});
export type OutputVersion = z.infer<typeof outputVersionSchema>;

// A result an agent showed the user with `show_result`. One per file or address in a task.
export const outputRecordSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  target: outputTargetSchema,
  // Oldest first; empty for a site.
  versions: z.array(outputVersionSchema),
  // When its saved picture was taken; one older than `updatedAt` is taken again.
  picturedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OutputRecord = z.infer<typeof outputRecordSchema>;

// A file an agent in the task wrote or deleted, from its actions.
export const changedFileSchema = z.object({
  path: z.string().min(1),
  agentId: z.string().min(1),
  deleted: z.boolean(),
  at: z.iso.datetime(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

// A local address seen in an agent's output that nobody showed as a result.
export const spottedSiteSchema = z.object({
  url: z.url(),
  agentId: z.string().min(1),
});
export type SpottedSite = z.infer<typeof spottedSiteSchema>;

export const taskOutputsSchema = z.object({
  results: z.array(outputRecordSchema),
  changed: z.array(changedFileSchema),
  // Only those that answered just now.
  spotted: z.array(spottedSiteSchema),
  // Sites among the results that answered just now.
  running: z.array(z.url()),
  // The task's folders, which paths are shown relative to.
  roots: z.array(z.string()),
  // How long each agent's latest conversation is, by agent id: resuming one reads all of it.
  contextTokens: z.record(z.string(), z.number().int().nonnegative()),
  // Agents whose folder was removed once their work was merged: only a fresh conversation, in
  // the lead's folder, can start their site again.
  freshOnly: z.array(z.string()),
  // Where a result's file is now, by result id, when that is not where it was shown: a worker's
  // file merged into the lead's folder.
  movedTo: z.record(z.string(), z.string()),
});
export type TaskOutputs = z.infer<typeof taskOutputsSchema>;

// A file of the task, or a kept version of a result.
export const outputFileQuerySchema = z.union([
  z.object({ path: z.string().min(1) }),
  z.object({ outputId: z.string().min(1), version: z.coerce.number().int().positive() }),
]);
export type OutputFileQuery = z.infer<typeof outputFileQuerySchema>;

// An address on the preview server, which serves nothing else and never the app (M8).
export const previewReplySchema = z.object({ url: z.url() });
export type PreviewReply = z.infer<typeof previewReplySchema>;

// `fresh`: a new conversation with a short brief instead of resuming a long one.
export const restartSiteRequestSchema = z.object({ fresh: z.boolean() });
export type RestartSiteRequest = z.infer<typeof restartSiteRequestSchema>;
