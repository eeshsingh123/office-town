import type { SentAttachment } from "@office-town/contract";

const TYPE_OF: Record<SentAttachment["kind"], string> = {
  file: "file",
  image: "image",
  folder: "folder",
};

function sizeOf(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `, ${bytes} B`;
  if (bytes < 1024 * 1024) return `, ${Math.round(bytes / 1024)} KB`;
  return `, ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The agent is told exactly what it has and where, and never to describe what it did not open.
export function attachmentNote(attachments: readonly SentAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const shown = attachment.inline ? ", also shown above" : "";
    const type = `${TYPE_OF[attachment.kind]}${sizeOf(attachment.bytes)}${shown}`;
    return `- ${attachment.name} (${type})\n  ${attachment.path}`;
  });
  return [
    "",
    "",
    "Files for this message (read-only):",
    ...lines,
    "Open a file before relying on it, and never describe a file you have not opened. " +
      "If one cannot be opened, say so.",
  ].join("\n");
}
