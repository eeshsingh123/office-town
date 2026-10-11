import { dirname, extname } from "node:path";
import {
  type Attachment,
  MAX_INLINE_IMAGE_BYTES,
  type SessionCommand,
  type SessionOptions,
} from "@office-town/contract";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import type { ReadCatalog } from "../team/catalogs.ts";

export type PromptAttachment = NonNullable<
  Extract<SessionCommand, { type: "prompt" }>["attachments"]
>[number];

// Images by their extension, which is what the harnesses go by too.
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function fileKindOf(name: string): { kind: "file" | "image"; mimeType?: string } {
  const extension = extname(name).toLowerCase();
  const image = IMAGE_TYPES[extension];
  if (image !== undefined) return { kind: "image", mimeType: image };
  return extension === ".pdf" ? { kind: "file", mimeType: "application/pdf" } : { kind: "file" };
}

export function resolveAttachments(store: Store, ids: readonly string[] = []): Attachment[] {
  return [...new Set(ids)].map((id) => {
    const attachment = store.getAttachment(id);
    if (attachment === undefined) throw new RecordNotFoundError("attachment", id);
    return attachment;
  });
}

// A copy's own folder, or the linked folder itself.
function accessPathOf(attachment: Attachment): string {
  return attachment.kind === "folder" ? attachment.path : dirname(attachment.path);
}

// Read-only, so the policy lets reads through and stops every change (D-64).
export function withAccess(options: SessionOptions, attachments: readonly Attachment[]) {
  const paths = attachments.map(accessPathOf);
  if (paths.length === 0) return options;
  const merged = (list: string[] = []) => [...new Set([...list, ...paths])];
  return {
    ...options,
    additionalPaths: merged(options.additionalPaths),
    readOnlyPaths: merged(options.readOnlyPaths),
  };
}

export function hasAccess(options: SessionOptions, attachments: readonly Attachment[]): boolean {
  const readable = new Set(options.readOnlyPaths ?? []);
  return attachments.every((attachment) => readable.has(accessPathOf(attachment)));
}

// An image also goes into the prompt when the model can see it and it is small enough.
export function forPrompt(
  attachments: readonly Attachment[],
  seesImages: boolean,
): PromptAttachment[] {
  return attachments.map((attachment) => {
    const inline =
      seesImages &&
      attachment.kind === "image" &&
      (attachment.bytes ?? Number.POSITIVE_INFINITY) <= MAX_INLINE_IMAGE_BYTES;
    return inline ? { ...attachment, inline } : attachment;
  });
}

// From the harness's own model list, so a new harness needs nothing here. With no model chosen,
// every model it offers must see images. Unknown means the path only, which claims nothing.
export function imageSight(readCatalog: ReadCatalog) {
  return async ({ harness, environment, model }: SessionOptions): Promise<boolean> => {
    let models: Awaited<ReturnType<ReadCatalog>>["models"];
    try {
      ({ models } = await readCatalog(harness, environment));
    } catch {
      // The images still reach the agent as paths.
      return false;
    }
    const chosen =
      model === undefined
        ? models
        : models.filter((known) => known.id === model || known.resolvedId === model);
    return chosen.length > 0 && chosen.every((known) => known.inputs?.includes("image") === true);
  };
}
