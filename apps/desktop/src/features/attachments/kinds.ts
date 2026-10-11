import type { AttachmentKind } from "@office-town/contract";

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
// The harnesses read these only with a tool of their own, if they have one.
const OFFICE = /\.(docx?|xlsx?|pptx?)$/i;

export const isImage = (name: string) => IMAGE.test(name);
export const isOffice = (name: string) => OFFICE.test(name);

// The short type shown on a file's tile, such as PDF or MD.
export function typeLabel(name: string, kind: AttachmentKind): string {
  if (kind === "folder") return "DIR";
  if (kind === "image") return "IMG";
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  return extension === undefined ? "FILE" : extension.slice(0, 4).toUpperCase();
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
