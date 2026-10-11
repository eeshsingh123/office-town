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

function lineOf(attachment: SentAttachment): string {
  const shown = attachment.inline ? ", also shown above" : "";
  const type = `${TYPE_OF[attachment.kind]}${sizeOf(attachment.bytes)}${shown}`;
  return `- ${attachment.name} (${type})\n  ${attachment.path}`;
}

// The agent is told exactly what it has and where, and never to describe what it did not open.
// Library items are reference: available, not required.
export function attachmentNote(attachments: readonly SentAttachment[]): string {
  if (attachments.length === 0) return "";
  const given = attachments.filter((attachment) => !attachment.reference);
  const reference = attachments.filter((attachment) => attachment.reference);
  return [
    "",
    ...(given.length === 0
      ? []
      : ["", "Files for this message (read-only):", ...given.map(lineOf)]),
    ...(reference.length === 0
      ? []
      : [
          "",
          "Reference files from the workspace Library, to use when they help (read-only):",
          ...reference.map(lineOf),
        ]),
    "Open a file before relying on it, and never describe a file you have not opened. " +
      "If one cannot be opened, say so.",
  ].join("\n");
}
